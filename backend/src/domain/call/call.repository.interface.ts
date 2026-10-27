import { Call, CallState } from './call.types.js';

export interface ICallRepository {
  findById(id: string): Promise<Call | null>;
  findByCampaign(campaignId: string): Promise<Call[]>;
  findByProviderCallId(providerCallId: string): Promise<Call | null>;
  findActiveByAgent(agentId: string): Promise<Call | null>;
  findActiveByBorrower(borrowerId: string): Promise<Call | null>;
  countActiveCalls(campaignId: string): Promise<number>;
  countAllActiveCalls(): Promise<number>;
  countByState(campaignId: string): Promise<Record<CallState, number>>;
  findInFlightCalls(campaignId: string): Promise<Call[]>;
  findStaleInitiatedCalls(campaignId: string, cutoffTime: Date): Promise<Call[]>;
  compareAndSwap(call: Call, expectedVersion: number): Promise<boolean>;
  save(call: Call): Promise<Call>;
}

