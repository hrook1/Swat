import { afterEach, expect, it, vi } from 'vitest';
import type { WorkerCommand, WorkerEvent } from '../shared/types';

const probe = vi.hoisted(() => ({
  advances: 0,
  throwOnAdvance: false,
  running: false,
  paused: false,
}));
vi.mock('./Game', () => ({
  Game: class {
    constructor() {
      probe.running = false;
      probe.paused = false;
    }
    advance() {
      probe.advances++;
      if (probe.throwOnAdvance) throw new Error('Synthetic kernel fault');
      return probe.running && !probe.paused ? 1 : 0;
    }
    isRunning() {
      return probe.running && !probe.paused;
    }
    setPaused(paused: boolean) {
      probe.paused = paused;
    }
    start() {
      probe.running = true;
    }
    reset() {
      probe.running = false;
    }
    snapshot(simSpeed: number) {
      return { simSpeed };
    }
    setPointer() {}
    setLesion() {}
  },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps one fallback timer and latches a fatal frame error against late resume commands', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const events: WorkerEvent[] = [];
  const port = {
    onmessage: null as ((event: { data: WorkerCommand }) => void) | null,
    postMessage: (event: WorkerEvent) => events.push(event),
  };
  vi.stubGlobal('self', port);
  probe.advances = 0;
  probe.throwOnAdvance = false;
  await import('./game.worker');
  const send = (data: WorkerCommand) => port.onmessage!({ data });
  // The fake Game isolates scheduling/error policy from the neural model.
  send({ type: 'init', circuit: {} as never, seed: 1 });
  expect(vi.getTimerCount()).toBe(1);
  send({ type: 'start' });
  now = 16;
  send({ type: 'frame' });
  expect(events.at(-1)?.type).toBe('frame-done');
  expect(probe.advances).toBe(16);
  expect(vi.getTimerCount()).toBe(1);

  probe.throwOnAdvance = true;
  now = 32;
  send({ type: 'frame' });
  expect(events.at(-1)).toEqual({ type: 'error', message: 'Synthetic kernel fault' });
  expect(probe.paused).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  const advancesAtFault = probe.advances;
  send({ type: 'pause', paused: false });
  send({ type: 'start' });
  send({ type: 'frame' });
  now = 100;
  vi.advanceTimersByTime(16);
  expect(probe.paused).toBe(true);
  expect(probe.advances).toBe(advancesAtFault);

  probe.throwOnAdvance = false;
  send({ type: 'init', circuit: {} as never, seed: 2 });
  send({ type: 'start' });
  now = 116;
  send({ type: 'frame' });
  expect(probe.paused).toBe(false);
  expect(probe.advances).toBeGreaterThan(advancesAtFault);
  expect(vi.getTimerCount()).toBe(1);
});
