import { Call, CallState } from '../../domain/call/call.types.js';
import { ICallRepository } from '../../domain/call/call.repository.interface.js';
import { CallModel, CallDoc } from './schemas.js';

export class MongooseCallRepository implements ICallRepository {
  private toDomain(doc: CallDoc): Call {
    return {
      id: doc._id,
      campaignId: doc.campaignId,
      borrowerId: doc.borrowerId,
      agentId: doc.agentId,
      providerId: doc.providerId,
      providerCallId: doc.providerCallId,
      state: doc.state,
      version: doc.version,
      queuedAt: doc.queuedAt,
      reservedAt: doc.reservedAt,
      initiatedAt: doc.initiatedAt,
      ringingAt: doc.ringingAt,
      answeredAt: doc.answeredAt,
      connectedAt: doc.connectedAt,
      endedAt: doc.endedAt,
      durationSeconds: doc.durationSeconds,
      failureReason: doc.failureReason,
      eventHistory: (doc.eventHistory || []).map((e: any) => ({
        eventId: e.eventId,
        eventType: e.eventType,
        fromState: e.fromState,
        toState: e.toState,
        timestamp: e.timestamp,
        reason: e.reason,
        payload: e.payload,
      })),
      createdAt: (doc as any).createdAt ?? new Date(),
      updatedAt: (doc as any).updatedAt ?? new Date(),
    };
  }

  public async findById(id: string): Promise<Call | null> {
    const doc = await CallModel.findById(id).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async findByCampaign(campaignId: string): Promise<Call[]> {
    const docs = await CallModel.find({ campaignId }).lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async findByProviderCallId(providerCallId: string): Promise<Call | null> {
    const doc = await CallModel.findOne({ providerCallId }).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async findActiveByAgent(agentId: string): Promise<Call | null> {
    const doc = await CallModel.findOne({
      agentId,
      state: { $nin: ['COMPLETED', 'FAILED', 'CANCELLED'] },
    }).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async findActiveByBorrower(borrowerId: string): Promise<Call | null> {
    const doc = await CallModel.findOne({
      borrowerId,
      state: { $nin: ['COMPLETED', 'FAILED', 'CANCELLED'] },
    }).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async countActiveCalls(campaignId: string): Promise<number> {
    return CallModel.countDocuments({
      campaignId,
      state: { $nin: ['COMPLETED', 'FAILED', 'CANCELLED'] },
    });
  }

  public async countAllActiveCalls(): Promise<number> {
    return CallModel.countDocuments({
      state: { $nin: ['COMPLETED', 'FAILED', 'CANCELLED'] },
    });
  }

  public async countByState(campaignId: string): Promise<Record<CallState, number>> {
    const result: Record<CallState, number> = {
      QUEUED: 0,
      RESERVED: 0,
      INITIATED: 0,
      RINGING: 0,
      ANSWERED: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };

    const counts = await CallModel.aggregate([
      { $match: { campaignId } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]);

    for (const item of counts) {
      if (item._id in result) {
        result[item._id as CallState] = item.count;
      }
    }

    return result;
  }

  public async findInFlightCalls(campaignId: string): Promise<Call[]> {
    const docs = await CallModel.find({
      campaignId,
      state: { $in: ['INITIATED', 'RINGING', 'ANSWERED'] },
    }).lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async findStaleInitiatedCalls(campaignId: string, cutoffTime: Date): Promise<Call[]> {
    const docs = await CallModel.find({
      campaignId,
      state: { $in: ['RESERVED', 'INITIATED', 'RINGING', 'ANSWERED', 'CONNECTED'] },
      updatedAt: { $lte: cutoffTime },
    }).lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async compareAndSwap(call: Call, expectedVersion: number): Promise<boolean> {
    const updated = await CallModel.findOneAndUpdate(
      { _id: call.id, version: expectedVersion },
      {
        $set: {
          campaignId: call.campaignId,
          borrowerId: call.borrowerId,
          agentId: call.agentId,
          providerId: call.providerId,
          providerCallId: call.providerCallId,
          state: call.state,
          version: call.version,
          queuedAt: call.queuedAt,
          reservedAt: call.reservedAt,
          initiatedAt: call.initiatedAt,
          ringingAt: call.ringingAt,
          answeredAt: call.answeredAt,
          connectedAt: call.connectedAt,
          endedAt: call.endedAt,
          durationSeconds: call.durationSeconds,
          failureReason: call.failureReason,
          eventHistory: call.eventHistory,
        },
      },
      { new: true }
    );
    return updated !== null;
  }

  public async save(call: Call): Promise<Call> {
    const doc = await CallModel.findByIdAndUpdate(
      call.id,
      {
        $set: {
          campaignId: call.campaignId,
          borrowerId: call.borrowerId,
          agentId: call.agentId,
          providerId: call.providerId,
          providerCallId: call.providerCallId,
          state: call.state,
          version: call.version,
          queuedAt: call.queuedAt,
          reservedAt: call.reservedAt,
          initiatedAt: call.initiatedAt,
          ringingAt: call.ringingAt,
          answeredAt: call.answeredAt,
          connectedAt: call.connectedAt,
          endedAt: call.endedAt,
          durationSeconds: call.durationSeconds,
          failureReason: call.failureReason,
          eventHistory: call.eventHistory,
        },
      },
      { upsert: true, new: true }
    ).lean();

    return this.toDomain(doc as any);
  }
}

