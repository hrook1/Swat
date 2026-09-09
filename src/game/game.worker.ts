import { Game } from './Game';
import { FixedStepScheduler } from './scheduler';
import type { WorkerCommand, WorkerEvent } from '../shared/types';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  postMessage(event: WorkerEvent): void;
};

let game: Game | null = null;
let paused = false;
let failed = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextPublish = 0;
const scheduler = new FixedStepScheduler();

function publish(): void {
  if (game) worker.postMessage({ type: 'snapshot', snapshot: game.snapshot(scheduler.simSpeed) });
}

function fail(error: unknown): void {
  // Every fatal path, including a frame-message wakeup, stops kernel work.
  // The timer may still publish the frozen/error state, but cannot integrate it.
  paused = true;
  failed = true;
  game?.setPaused(true);
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  worker.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

function pump(): void {
  if (failed) return;
  const now = scheduler.pump(game, paused);
  if (now >= nextPublish) {
    publish();
    nextPublish = now + 1000 / 30;
  }
}

function scheduleTimer(): void {
  if (failed) return;
  timer = setTimeout(() => {
    timer = undefined;
    try {
      pump();
    } catch (error) {
      fail(error);
    }
    scheduleTimer();
  }, 4);
}

worker.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      if (timer !== undefined) clearTimeout(timer);
      if (failed) paused = false;
      failed = false;
      game = new Game(data.circuit, data.seed);
      game.setPaused(paused);
      scheduler.reset(true);
      nextPublish = 0;
      worker.postMessage({ type: 'ready' });
      pump();
      scheduleTimer();
      return;
    }
    // Late visibility/resume/frame messages cannot restart a failed kernel.
    // Recovery requires an explicit initialization with a fresh circuit.
    if (failed) return;
    if (data.type === 'frame') {
      // Messages from rAF can wake a worker whose own timers were throttled.
      // This does not create another timer or use a manufactured frame duration.
      pump();
      worker.postMessage({ type: 'frame-done' });
      return;
    }
    if (!game) return;
    switch (data.type) {
      case 'start':
        game.start();
        scheduler.reset(true);
        break;
      case 'reset':
        game.reset(data.seed);
        scheduler.reset(true);
        break;
      case 'pointer':
        game.setPointer(data.x, data.y, data.active);
        return;
      case 'swat':
        game.swat();
        break;
      case 'lesion':
        game.setLesion(data.mode);
        break;
      case 'pause':
        paused = data.paused;
        game.setPaused(paused);
        scheduler.reset();
        break;
    }
    publish();
  } catch (error) {
    fail(error);
  }
};
