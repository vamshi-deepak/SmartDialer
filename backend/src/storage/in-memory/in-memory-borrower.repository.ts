import { Borrower, BorrowerReservationResult, BorrowerState } from '../../domain/borrower/borrower.types.js';
import { IBorrowerRepository } from '../../domain/borrower/borrower.repository.interface.js';

export class InMemoryBorrowerRepository implements IBorrowerRepository {
  private readonly borrowers = new Map<string, Borrower>();
  private readonly lockSet = new Set<string>();

  public async findById(id: string): Promise<Borrower | null> {
    const b = this.borrowers.get(id);
    return b ? { ...b } : null;
  }

  public async findByCampaign(campaignId: string): Promise<Borrower[]> {
    return Array.from(this.borrowers.values())
      .filter((b) => b.campaignId === campaignId)
      .map((b) => ({ ...b }));
  }

  public async findNextEligible(campaignId: string, limit?: number): Promise<Borrower[]> {
    const list = Array.from(this.borrowers.values())
      .filter((b) => b.campaignId === campaignId && b.state === 'QUEUED')
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .map((b) => ({ ...b }));
    return limit ? list.slice(0, limit) : list;
  }

  public async countByState(campaignId: string): Promise<Record<BorrowerState, number>> {
    const counts: Record<BorrowerState, number> = {
      QUEUED: 0,
      RESERVED: 0,
      DIALING: 0,
      CONNECTED: 0,
      COMPLETED: 0,
      UNREACHABLE: 0,
    };

    for (const b of this.borrowers.values()) {
      if (b.campaignId === campaignId) {
        counts[b.state] = (counts[b.state] ?? 0) + 1;
      }
    }

    return counts;
  }

  public async atomicReserve(
    borrowerId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<BorrowerReservationResult> {
    if (this.lockSet.has(borrowerId)) {
      return {
        success: false,
        error: `Borrower ${borrowerId} is locked by another worker.`,
      };
    }
    this.lockSet.add(borrowerId);

    try {
      const current = this.borrowers.get(borrowerId);
      if (!current) {
        return { success: false, error: `Borrower ${borrowerId} not found.` };
      }

      if (current.state !== 'QUEUED') {
        return {
          success: false,
          error: `Borrower ${borrowerId} is in state '${current.state}', expected 'QUEUED'.`,
        };
      }

      if (current.version !== expectedVersion) {
        return {
          success: false,
          error: `Borrower ${borrowerId} version mismatch. Expected ${expectedVersion}, found ${current.version}.`,
        };
      }

      const updated: Borrower = {
        ...current,
        state: 'RESERVED',
        version: current.version + 1,
        reservationLeaseExpiresAt: leaseExpiresAt,
        updatedAt: new Date(),
      };
      this.borrowers.set(borrowerId, updated);

      return {
        success: true,
        borrower: { ...updated },
        leaseExpiresAt,
      };
    } finally {
      this.lockSet.delete(borrowerId);
    }
  }

  public async atomicRelease(borrowerId: string, toState: BorrowerState): Promise<boolean> {
    if (this.lockSet.has(borrowerId)) {
      return false;
    }
    this.lockSet.add(borrowerId);

    try {
      const current = this.borrowers.get(borrowerId);
      if (!current) return false;

      const updated: Borrower = {
        ...current,
        state: toState,
        version: current.version + 1,
        reservationLeaseExpiresAt: null,
        updatedAt: new Date(),
      };
      this.borrowers.set(borrowerId, updated);
      return true;
    } finally {
      this.lockSet.delete(borrowerId);
    }
  }

  public async updateState(
    borrowerId: string,
    toState: BorrowerState,
    incrementAttempt = false
  ): Promise<Borrower> {
    const current = this.borrowers.get(borrowerId);
    if (!current) {
      throw new Error(`Borrower ${borrowerId} not found.`);
    }

    const updated: Borrower = {
      ...current,
      state: toState,
      attemptsCount: incrementAttempt ? current.attemptsCount + 1 : current.attemptsCount,
      lastAttemptAt: incrementAttempt ? new Date() : current.lastAttemptAt,
      version: current.version + 1,
      reservationLeaseExpiresAt: toState === 'RESERVED' ? current.reservationLeaseExpiresAt : null,
      updatedAt: new Date(),
    };

    this.borrowers.set(borrowerId, updated);
    return { ...updated };
  }

  public async compareAndSwap(borrower: Borrower, expectedVersion: number): Promise<boolean> {
    const current = this.borrowers.get(borrower.id);
    if (!current || current.version !== expectedVersion) return false;
    this.borrowers.set(borrower.id, { ...borrower });
    return true;
  }

  public async findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Borrower[]> {
    return Array.from(this.borrowers.values())
      .filter(
        (b) =>
          b.campaignId === campaignId &&
          b.state === 'RESERVED' &&
          b.reservationLeaseExpiresAt !== null &&
          b.reservationLeaseExpiresAt <= cutoffTime
      )
      .map((b) => ({ ...b }));
  }

  public async save(borrower: Borrower): Promise<Borrower> {
    this.borrowers.set(borrower.id, { ...borrower });
    return { ...borrower };
  }

  public clear(): void {
    this.borrowers.clear();
    this.lockSet.clear();
  }
}

