export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number; // consecutive failures to trip
  cooldownPeriodMs: number; // time in OPEN before entering HALF_OPEN
  halfOpenSuccessThreshold: number; // successful calls to heal back to CLOSED
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private lastFailureTime: Date | null = null;
  private stateChangedAt: Date = new Date();

  constructor(
    private readonly config: CircuitBreakerConfig = {
      failureThreshold: 5,
      cooldownPeriodMs: 15000,
      halfOpenSuccessThreshold: 2,
    }
  ) {}

  public getState(): CircuitState {
    if (this.state === 'OPEN' && this.lastFailureTime) {
      const elapsed = Date.now() - this.lastFailureTime.getTime();
      if (elapsed >= this.config.cooldownPeriodMs) {
        this.transitionTo('HALF_OPEN', 'Cooldown period elapsed; probing provider health.');
      }
    }
    return this.state;
  }

  public canExecute(): boolean {
    const currentState = this.getState();
    if (currentState === 'CLOSED') return true;
    if (currentState === 'HALF_OPEN') return true; // Allows controlled probe
    return false; // OPEN blocks all execution
  }

  public recordSuccess(): void {
    this.totalSuccesses++;
    this.consecutiveFailures = 0;

    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo('CLOSED', 'Probe requests succeeded; provider restored.');
      }
    }
  }

  public recordFailure(reason: string): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = new Date();

    if (this.state === 'CLOSED' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo(
        'OPEN',
        `Tripped: ${this.consecutiveFailures} consecutive failures. Reason: ${reason}`
      );
    } else if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN', `Probe failed in HALF_OPEN: ${reason}. Circuit reopened.`);
    }
  }

  public getHealthScore(): number {
    const total = this.totalSuccesses + this.totalFailures;
    if (total === 0) return 1.0;
    const rate = this.totalSuccesses / total;
    if (this.state === 'OPEN') return Math.min(rate, 0.1);
    if (this.state === 'HALF_OPEN') return Math.min(rate, 0.5);
    return rate;
  }

  public forceOpen(reason: string): void {
    this.lastFailureTime = new Date();
    this.transitionTo('OPEN', `Manual intervention: ${reason}`);
  }

  public reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = null;
    this.transitionTo('CLOSED', 'Circuit breaker manually reset.');
  }

  private transitionTo(nextState: CircuitState, _reason: string): void {
    this.state = nextState;
    this.stateChangedAt = new Date();
    if (nextState === 'CLOSED') {
      this.consecutiveFailures = 0;
    }
  }

  public getSnapshot(): {
    state: CircuitState;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    healthScore: number;
    stateChangedAt: Date;
  } {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      healthScore: this.getHealthScore(),
      stateChangedAt: this.stateChangedAt,
    };
  }
}

