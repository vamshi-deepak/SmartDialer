export type BorrowerState =
  | 'QUEUED'
  | 'RESERVED'
  | 'DIALING'
  | 'CONNECTED'
  | 'COMPLETED'
  | 'UNREACHABLE';

export interface Borrower {
  id: string;
  campaignId: string;
  name: string;
  phoneNumber: string;
  debtAmount: number;
  priority: number;
  state: BorrowerState;
  attemptsCount: number;
  version: number;
  lastAttemptAt: Date | null;
  reservationLeaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BorrowerReservationResult {
  success: boolean;
  borrower?: Borrower;
  error?: string;
  leaseExpiresAt?: Date;
}

