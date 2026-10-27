import { Borrower, BorrowerReservationResult, BorrowerState } from './borrower.types.js';

export interface IBorrowerRepository {
  findById(id: string): Promise<Borrower | null>;
  findByCampaign(campaignId: string): Promise<Borrower[]>;
  findNextEligible(campaignId: string, limit?: number): Promise<Borrower[]>;
  
  /**
   * Atomically transitions borrower from QUEUED to RESERVED.
   * Prevents two dialer workers from calling the same borrower concurrently.
   */
  atomicReserve(
    borrowerId: string,
    expectedVersion: number,
    leaseExpiresAt: Date
  ): Promise<BorrowerReservationResult>;

  /**
   * Releases borrower reservation back to QUEUED or specified state.
   */
  atomicRelease(borrowerId: string, toState: BorrowerState): Promise<boolean>;

  /**
   * Updates borrower state and attempts count.
   */
  updateState(
    borrowerId: string,
    toState: BorrowerState,
    incrementAttempt?: boolean
  ): Promise<Borrower>;
  compareAndSwap(borrower: Borrower, expectedVersion: number): Promise<boolean>;

  /**
   * Identifies borrowers stuck in RESERVED state whose lease expired.
   */
  findStaleReservations(campaignId: string, cutoffTime: Date): Promise<Borrower[]>;

  /**
   * Saves or creates a borrower record.
   */
  save(borrower: Borrower): Promise<Borrower>;

  /**
   * Count borrowers by state for a campaign.
   */
  countByState(campaignId: string): Promise<Record<BorrowerState, number>>;
}

