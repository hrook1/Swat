import type { CircuitData, GameSnapshot, WorkerCommand, WorkerEvent } from '../shared/types';

export interface GameClientOptions {
  onSnapshot(snapshot: GameSnapshot): void;
  onReady?(): void;
  onError?(message: string): void;
}

/** Main-thread adapter; visibility pause is automatic and has no catch-up debt. */
export class GameClient {
  private readonly worker: Worker;
  private manualPause = false;
  private disposed = false;
  private readonly onVisibility = () => this.sendPause();

  constructor(options: GameClientOptions) {
    this.worker = new Worker(new URL('./game.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<WorkerEvent>) => {
      if (this.disposed) return;
      if (data.type === 'snapshot') options.onSnapshot(data.snapshot);
      else if (data.type === 'ready') {
        this.sendPause();
        options.onReady?.();
      } else if (data.type === 'error') options.onError?.(data.message);
    };
    this.worker.onerror = (event) =>
      options.onError?.(event.message || 'The simulation could not start.');
    this.worker.onmessageerror = () =>
      options.onError?.('The simulation sent an unreadable update.');
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  init(circuit: CircuitData, seed: number): void {
    this.send({ type: 'init', circuit, seed });
  }

  send(command: WorkerCommand): void {
    if (this.disposed) return;
    if (command.type === 'pause') {
      this.manualPause = command.paused;
      this.sendPause();
    } else {
      this.worker.postMessage(command);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.worker.terminate();
  }

  private sendPause(): void {
    if (!this.disposed)
      this.worker.postMessage({
        type: 'pause',
        paused: this.manualPause || document.hidden,
      } satisfies WorkerCommand);
  }
}
