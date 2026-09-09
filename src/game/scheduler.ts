export interface FixedStepper {
  advance(milliseconds: number): number;
  isRunning(): boolean;
}

/**
 * Both worker timers and coalesced visible-page animation frames may wake this
 * scheduler. They share one wall clock/debt ledger, so extra wakeups cannot
 * double the simulated time. Neural integration always remains exactly 1 ms.
 */
export class FixedStepScheduler {
  private previousWall = 0;
  private pendingMs = 0;
  private sampleWall = 0;
  private sampleSimulated = 0;
  private speed = 1;

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.reset();
  }

  reset(resetSpeed = false): void {
    this.previousWall = this.sampleWall = this.clock();
    this.pendingMs = this.sampleSimulated = 0;
    if (resetSpeed) this.speed = 1;
  }

  get simSpeed(): number {
    return this.speed;
  }

  pump(game: FixedStepper | null, paused: boolean): number {
    const now = this.clock();
    const elapsedWall = Math.max(0, now - this.previousWall);
    this.previousWall = now;
    if (!game || paused) return now;

    // A delayed worker does not run an unbounded backlog or increase neuron dt.
    // Dropped wall time remains visible in the measured simulation-speed ratio.
    this.pendingMs = Math.min(100, this.pendingMs + elapsedWall);
    const deadline = this.clock() + 7;
    if (this.pendingMs >= 1) {
      do {
        // Check the budget AFTER one unit of work. Preemption/coarse timing
        // between deadline creation and the first check must not starve all work.
        const advanced = game.advance(1);
        this.pendingMs -= 1;
        this.sampleSimulated += advanced;
        if (advanced === 0) {
          this.pendingMs = 0;
          break;
        }
      } while (this.pendingMs >= 1 && this.clock() < deadline);
    }
    if (now - this.sampleWall >= 750) {
      if (game.isRunning()) this.speed = this.sampleSimulated / (now - this.sampleWall);
      this.sampleWall = now;
      this.sampleSimulated = 0;
    }
    return now;
  }
}
