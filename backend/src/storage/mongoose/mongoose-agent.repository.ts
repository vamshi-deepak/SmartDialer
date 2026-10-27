import { Agent, AgentReservationResult, AgentState } from '../../domain/agent/agent.types.js';
import { IAgentRepository } from '../../domain/agent/agent.repository.interface.js';
import { AgentStateMachine } from '../../domain/agent/agent.state-machine.js';
import { AgentModel, AgentDoc } from './schemas.js';

export class MongooseAgentRepository implements IAgentRepository {
  private toDomain(doc: AgentDoc): Agent {
    return {
      id: doc._id,
      campaignId: doc.campaignId,
      name: doc.name,
      state: doc.state,
      currentCallId: doc.currentCallId,
      version: doc.version,
      reservationLeaseExpiresAt: doc.reservationLeaseExpiresAt,
      lastStateChangeAt: doc.lastStateChangeAt,
      stateChangeReason: doc.stateChangeReason,
      stats: doc.stats,
      createdAt: (doc as any).createdAt ?? new Date(),
      updatedAt: (doc as any).updatedAt ?? new Date(),
    };
  }

  public async findById(id: string): Promise<Agent | null> {
    const doc = await AgentModel.findById(id).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async findByCampaign(campaignId: string): Promise<Agent[]> {
    const docs = await AgentModel.find({ campaignId }).lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async findAvailableAgents(campaignId: string, limit?: number): Promise<Agent[]> {
    const query = AgentModel.find({ campaignId, state: 'AVAILABLE' });
    if (limit) query.limit(limit);
    const docs = await query.lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async countByState(campaignId: string): Promise<Record<AgentState, number>> {
    const result: Record<AgentState, number> = {
      OFFLINE: 0,
      AVAILABLE: 0,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      WRAP_UP: 0,
      PAUSED: 0,
    };

    const counts = await AgentModel.aggregate([
      { $match: { campaignId } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]);

    for (const item of counts) {
      if (item._id in result) {
        result[item._id as AgentState] = item.count;
      }
    }

    return result;
  }

  /**
   * Atomic Compare-And-Swap using MongoDB findOneAndUpdate with condition:
   * { _id: agentId, state: 'AVAILABLE', version: expectedVersion }
   */
  public async atomicReserve(
    agentId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<AgentReservationResult> {
    const now = new Date();
    const updated = await AgentModel.findOneAndUpdate(
      {
        _id: agentId,
        state: 'AVAILABLE',
        version: expectedVersion,
      },
      {
        $set: {
          state: 'RESERVED',
          reservationLeaseExpiresAt: leaseExpiresAt,
          lastStateChangeAt: now,
          stateChangeReason: 'Atomic reservation for dialing',
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return {
        success: false,
        error: `Agent ${agentId} is no longer AVAILABLE or version mismatch.`,
      };
    }

    return {
      success: true,
      agent: this.toDomain(updated as any),
      leaseExpiresAt,
    };
  }

  public async atomicRelease(agentId: string, reason: string): Promise<boolean> {
    const now = new Date();
    const res = await AgentModel.findOneAndUpdate(
      {
        _id: agentId,
        state: { $in: ['RESERVED', 'DIALING'] },
      },
      {
        $set: {
          state: 'AVAILABLE',
          currentCallId: null,
          reservationLeaseExpiresAt: null,
          lastStateChangeAt: now,
          stateChangeReason: reason,
          updatedAt: now,
        },
        $inc: { version: 1 },
      }
    );
    return res !== null;
  }

  public async updateState(
    agentId: string,
    toState: AgentState,
    reason: string,
    currentCallId?: string | null
  ): Promise<Agent> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const currentDoc = await AgentModel.findById(agentId).lean();
      if (!currentDoc) throw new Error(`Agent ${agentId} not found.`);
      const current = this.toDomain(currentDoc as any);
      const transitioned = AgentStateMachine.transition(current, toState, reason, currentCallId);
      const updated = await AgentModel.findOneAndUpdate(
        { _id: agentId, state: current.state, version: current.version },
        {
          $set: {
            state: transitioned.state,
            currentCallId: transitioned.currentCallId,
            reservationLeaseExpiresAt: transitioned.reservationLeaseExpiresAt,
            lastStateChangeAt: transitioned.lastStateChangeAt,
            stateChangeReason: transitioned.stateChangeReason,
            updatedAt: transitioned.updatedAt,
          },
          $inc: { version: 1 },
        },
        { new: true }
      ).lean();
      if (updated) return this.toDomain(updated as any);
    }

    throw new Error(`Agent ${agentId} changed concurrently during state transition.`);
  }

  public async compareAndSwap(agent: Agent, expectedVersion: number): Promise<boolean> {
    const result = await AgentModel.findOneAndUpdate(
      { _id: agent.id, version: expectedVersion },
      {
        $set: {
          state: agent.state,
          currentCallId: agent.currentCallId,
          reservationLeaseExpiresAt: agent.reservationLeaseExpiresAt,
          lastStateChangeAt: agent.lastStateChangeAt,
          stateChangeReason: agent.stateChangeReason,
          updatedAt: agent.updatedAt,
          stats: agent.stats,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    return result !== null;
  }

  public async findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Agent[]> {
    const docs = await AgentModel.find({
      campaignId,
      state: 'RESERVED',
      reservationLeaseExpiresAt: { $ne: null, $lte: cutoffTime },
    }).lean();

    return docs.map((d) => this.toDomain(d as any));
  }

  public async save(agent: Agent): Promise<Agent> {
    const doc = await AgentModel.findByIdAndUpdate(
      agent.id,
      {
        $set: {
          campaignId: agent.campaignId,
          name: agent.name,
          state: agent.state,
          currentCallId: agent.currentCallId,
          version: agent.version,
          reservationLeaseExpiresAt: agent.reservationLeaseExpiresAt,
          lastStateChangeAt: agent.lastStateChangeAt,
          stateChangeReason: agent.stateChangeReason,
          stats: agent.stats,
        },
      },
      { upsert: true, new: true }
    ).lean();

    return this.toDomain(doc as any);
  }
}

