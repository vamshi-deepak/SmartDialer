import { Borrower, BorrowerReservationResult, BorrowerState } from '../../domain/borrower/borrower.types.js';
import { IBorrowerRepository } from '../../domain/borrower/borrower.repository.interface.js';
import { BorrowerModel, BorrowerDoc } from './schemas.js';

export class MongooseBorrowerRepository implements IBorrowerRepository {
  private toDomain(doc: BorrowerDoc): Borrower {
    return {
      id: doc._id,
      campaignId: doc.campaignId,
      name: doc.name,
      phoneNumber: doc.phoneNumber,
      debtAmount: doc.debtAmount,
      priority: doc.priority,
      state: doc.state,
      attemptsCount: doc.attemptsCount,
      version: doc.version,
      lastAttemptAt: doc.lastAttemptAt,
      reservationLeaseExpiresAt: doc.reservationLeaseExpiresAt,
      createdAt: (doc as any).createdAt ?? new Date(),
      updatedAt: (doc as any).updatedAt ?? new Date(),
    };
  }

  public async findById(id: string): Promise<Borrower | null> {
    const doc = await BorrowerModel.findById(id).lean();
    return doc ? this.toDomain(doc as any) : null;
  }

  public async findByCampaign(campaignId: string): Promise<Borrower[]> {
    const docs = await BorrowerModel.find({ campaignId }).lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async findNextEligible(campaignId: string, limit?: number): Promise<Borrower[]> {
    const query = BorrowerModel.find({ campaignId, state: 'QUEUED' }).sort({
      priority: -1,
      createdAt: 1,
    });
    if (limit) query.limit(limit);
    const docs = await query.lean();
    return docs.map((d) => this.toDomain(d as any));
  }

  public async countByState(campaignId: string): Promise<Record<BorrowerState, number>> {
    const result: Record<BorrowerState, number> = {
      QUEUED: 0,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      UNREACHABLE: 0,
    };

    const counts = await BorrowerModel.aggregate([
      { $match: { campaignId } },
      { $group: { _id: '$state', count: { $sum: 1 } } },
    ]);

    for (const item of counts) {
      if (item._id in result) {
        result[item._id as BorrowerState] = item.count;
      }
    }

    return result;
  }

  public async atomicReserve(
    borrowerId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<BorrowerReservationResult> {
    const now = new Date();
    const updated = await BorrowerModel.findOneAndUpdate(
      {
        _id: borrowerId,
        state: 'QUEUED',
        version: expectedVersion,
      },
      {
        $set: {
          state: 'RESERVED',
          reservationLeaseExpiresAt: leaseExpiresAt,
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      { new: true }
    ).lean();

    if (!updated) {
      return {
        success: false,
        error: `Borrower ${borrowerId} is not in QUEUED state or version mismatch.`,
      };
    }

    return {
      success: true,
      borrower: this.toDomain(updated as any),
      leaseExpiresAt,
    };
  }

  public async atomicRelease(borrowerId: string, toState: BorrowerState): Promise<boolean> {
    const now = new Date();
    const res = await BorrowerModel.findByIdAndUpdate(borrowerId, {
      $set: {
        state: toState,
        reservationLeaseExpiresAt: null,
        updatedAt: now,
      },
      $inc: { version: 1 },
    });
    return res !== null;
  }

  public async updateState(
    borrowerId: string,
    toState: BorrowerState,
    incrementAttempt = false
  ): Promise<Borrower> {
    const now = new Date();
    const updateQuery: any = {
      $set: {
        state: toState,
        updatedAt: now,
        reservationLeaseExpiresAt: null,
      },
      $inc: { version: 1 },
    };

    if (incrementAttempt) {
      updateQuery.$inc.attemptsCount = 1;
      updateQuery.$set.lastAttemptAt = now;
    }

    const doc = await BorrowerModel.findByIdAndUpdate(borrowerId, updateQuery, {
      new: true,
    }).lean();

    if (!doc) {
      throw new Error(`Borrower ${borrowerId} not found.`);
    }

    return this.toDomain(doc as any);
  }

  public async compareAndSwap(borrower: Borrower, expectedVersion: number): Promise<boolean> {
    const result = await BorrowerModel.findOneAndUpdate(
      { _id: borrower.id, version: expectedVersion },
      {
        $set: {
          state: borrower.state,
          attemptsCount: borrower.attemptsCount,
          lastAttemptAt: borrower.lastAttemptAt,
          reservationLeaseExpiresAt: borrower.reservationLeaseExpiresAt,
          updatedAt: borrower.updatedAt,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );
    return result !== null;
  }

  public async findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Borrower[]> {
    const docs = await BorrowerModel.find({
      campaignId,
      state: 'RESERVED',
      reservationLeaseExpiresAt: { $ne: null, $lte: cutoffTime },
    }).lean();

    return docs.map((d) => this.toDomain(d as any));
  }

  public async save(borrower: Borrower): Promise<Borrower> {
    const doc = await BorrowerModel.findByIdAndUpdate(
      borrower.id,
      {
        $set: {
          campaignId: borrower.campaignId,
          name: borrower.name,
          phoneNumber: borrower.phoneNumber,
          debtAmount: borrower.debtAmount,
          priority: borrower.priority,
          state: borrower.state,
          attemptsCount: borrower.attemptsCount,
          version: borrower.version,
          lastAttemptAt: borrower.lastAttemptAt,
          reservationLeaseExpiresAt: borrower.reservationLeaseExpiresAt,
        },
      },
      { upsert: true, new: true }
    ).lean();

    return this.toDomain(doc as any);
  }
}

