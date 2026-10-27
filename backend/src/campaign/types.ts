export type DialingMode = 'PROGRESSIVE' | 'PREDICTIVE';
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'STOPPED';

export interface CampaignConfig {
  dialingMode: DialingMode;
  maxConcurrentCalls: number;
  targetAbandonmentRate: number; // e.g. 0.03 (3%)
  reservationLeaseDurationSeconds: number;
  providerId: 'reliable' | 'unreliable';
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  config: CampaignConfig;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

