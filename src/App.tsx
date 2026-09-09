import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Download,
  Film,
  Focus,
  LoaderCircle,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { ArenaRenderer } from './render/ArenaRenderer';
import { BrainRenderer } from './render/BrainRenderer';
import { recordingFrameTime } from './render/recordingCadence';
import { CATCH_PRESENTATION_SECONDS } from './render/CatchVisualState';
import { neuralColors, palette } from './theme/palette';
import { InfoModal } from './components/InfoModal';
import type { InfoModalKind } from './shared/infoModal';
import type { CircuitData, GameSnapshot, Neuron, WorkerCommand, WorkerEvent } from './shared/types';

const EMPTY: GameSnapshot = {
  mode: 'ready',
  time: 0,
  elapsed: 0,
  duration: 30,
  fly: { x: 500, y: 325, heading: -0.5, speed: 0 },
  threat: { x: 500, y: 325, active: false, swatting: 0 },
  neural: {
    retreat: 0,
    turn: 0,
    activity: new Float32Array(),
    disabled: new Uint8Array(),
    spikeCount: 0,
    meanHz: 0,
    aliveNeurons: 0,
  },
  lesion: 'intact',
  swats: 0,
  dodges: 0,
  swatCooldown: 0,
  simSpeed: 1,
  seed: 42,
};
// One real circuit, fully enabled. Smaller models remain offline test fixtures.
const CIRCUIT_PATH = '/data/circuit-expanded.json';
const fmt = (value: number) => new Intl.NumberFormat('en').format(value);
const getSeed = () => {
  const seed = Number(new URLSearchParams(location.search).get('seed'));
  return Number.isSafeInteger(seed) && seed > 0
    ? seed
    : crypto.getRandomValues(new Uint32Array(1))[0] || 42;
};

function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand${small ? ' brand-small' : ''}`}>
      <img src="/favicon.svg" width={small ? 28 : 35} height={small ? 28 : 35} alt="" />
      <span>
        Swat<span className="brand-period">.</span>
      </span>
    </span>
  );
}

export default function App() {
  const [circuit, setCircuit] = useState<CircuitData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<GameSnapshot>(EMPTY);
  const [modal, setModal] = useState<InfoModalKind | null>('welcome');
  const [paused, setPaused] = useState(false);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [catchSettled, setCatchSettled] = useState(false);
  const catchSettledRef = useRef(false);
  const [hasReplay, setHasReplay] = useState(false);
  const [toast, setToast] = useState('');
  const [selectedNeuron, setSelectedNeuron] = useState<Neuron | null>(null);
  const [modelStatus, setModelStatus] = useState('Loading circuit…');
  const [fps, setFps] = useState(60);
  const [touchUsed, setTouchUsed] = useState(false);
  const aimRef = useRef({ x: 500, y: 325, active: false });
  const seedRef = useRef(getSeed());
  const brainGesture = useRef<[number, number] | null>(null);
  const worker = useRef<Worker | null>(null);
  const framePending = useRef(false);
  const workerHealthy = useRef(false);
  const arenaCanvas = useRef<HTMLCanvasElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const brainCanvas = useRef<HTMLCanvasElement>(null);
  const arena = useRef<ArenaRenderer | null>(null);
  const brain = useRef<BrainRenderer | null>(null);
  const live = useRef(EMPTY);
  const painted = useRef(EMPTY);
  const circuitRef = useRef<CircuitData | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const releaseRecording = useRef<(() => void) | null>(null);
  const composite = useRef<HTMLCanvasElement | null>(null);
  const replayFrames = useRef<GameSnapshot[]>([]);
  const highlightFrames = useRef<GameSnapshot[]>([]);
  const highlightUntil = useRef(-Infinity);
  const replay = useRef<{ frames: GameSnapshot[]; cursor: number; label: string } | null>(null);
  const pausedRef = useRef(false);
  const modalRef = useRef(modal);
  modalRef.current = modal;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const command = useCallback((message: WorkerCommand) => worker.current?.postMessage(message), []);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setReady(false);
    setError('');
    setModelStatus('Loading circuit…');
    framePending.current = false;
    workerHealthy.current = false;
    setCircuit(null);
    circuitRef.current = null;
    live.current = EMPTY;
    painted.current = EMPTY;
    setSnapshot(EMPTY);
    replay.current = null;
    replayFrames.current = [];
    highlightFrames.current = [];
    highlightUntil.current = -Infinity;
    setReplaying(false);
    setHasReplay(false);
    setSelectedNeuron(null);
    setPaused(false);
    pausedRef.current = false;
    fetch(CIRCUIT_PATH, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('The brain couldn’t load. Please try again.');
        const data = (await response.json()) as CircuitData;
        if (!data.neurons?.length || !data.edges?.length)
          throw new Error('The circuit file is incomplete.');
        if (!active) return;
        setModelStatus('Connecting neurons…');
        setCircuit(data);
        circuitRef.current = data;
        const engine = new Worker(new URL('./game/game.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.current = engine;
        let lastUi = 0;
        let lastSaved = -Infinity;
        let previousTime = -Infinity;
        let previousMode = 'ready';
        let previousSwats = 0;
        engine.onmessage = ({ data: message }: MessageEvent<WorkerEvent>) => {
          if (!active) return;
          if (message.type === 'frame-done') {
            framePending.current = false;
            return;
          }
          if (message.type === 'ready') {
            workerHealthy.current = true;
            setReady(true);
            setModelStatus('');
          }
          if (message.type === 'error') {
            workerHealthy.current = false;
            framePending.current = false;
            setError(message.message);
            setReady(false);
          }
          if (message.type === 'snapshot') {
            if (message.snapshot.swats > previousSwats) {
              highlightFrames.current = replayFrames.current.slice(-15);
              highlightUntil.current = message.snapshot.time + 3;
            }
            previousSwats = message.snapshot.swats;
            live.current = message.snapshot;
            if (message.snapshot.time < previousTime) lastSaved = -Infinity;
            const now = performance.now();
            if (
              !replay.current &&
              (now - lastUi > 100 || message.snapshot.mode !== painted.current.mode)
            ) {
              lastUi = now;
              setSnapshot(message.snapshot);
            }
            if (message.snapshot.mode === 'playing' && message.snapshot.time - lastSaved >= 0.064) {
              lastSaved = message.snapshot.time;
              replayFrames.current.push(message.snapshot);
              if (replayFrames.current.length > 165) replayFrames.current.shift();
              if (message.snapshot.time <= highlightUntil.current) {
                highlightFrames.current.push(message.snapshot);
                if (highlightFrames.current.length > 80) highlightFrames.current.shift();
              }
            }
            if (message.snapshot.mode === 'ready') {
              lastSaved = -Infinity;
            }
            if (message.snapshot.mode === 'caught' || message.snapshot.mode === 'escaped') {
              if (previousMode === 'playing') {
                replayFrames.current.push(message.snapshot);
                if (message.snapshot.time <= highlightUntil.current)
                  highlightFrames.current.push(message.snapshot);
              }
              setHasReplay(replayFrames.current.length > 2);
            }
            previousTime = message.snapshot.time;
            previousMode = message.snapshot.mode;
          }
        };
        engine.onerror = () => {
          workerHealthy.current = false;
          framePending.current = false;
          setError('The simulation stopped. Reload to start a new experiment.');
          setReady(false);
        };
        engine.postMessage({
          type: 'init',
          circuit: data,
          seed: seedRef.current,
        } satisfies WorkerCommand);
      })
      .catch((err) => {
        if (active && err.name !== 'AbortError')
          setError(err instanceof Error ? err.message : 'Unable to load the brain.');
      });
    return () => {
      active = false;
      controller.abort();
      worker.current?.terminate();
      worker.current = null;
      framePending.current = false;
      workerHealthy.current = false;
    };
  }, []);

  useEffect(() => {
    if (!arenaCanvas.current) return;
    try {
      arena.current = new ArenaRenderer(arenaCanvas.current);
    } catch {
      setError(
        'This browser couldn’t start the 3D view. Try a recent browser with graphics acceleration.',
      );
      return;
    }
    const canvas = arenaCanvas.current;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width && height) arena.current?.resize(width, height);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      arena.current?.dispose();
      arena.current = null;
    };
  }, []);

  useEffect(() => {
    if (!circuit || !brainCanvas.current) return;
    try {
      brain.current = new BrainRenderer(brainCanvas.current, circuit);
    } catch {
      notify('The brain viewer needs graphics acceleration. The simulation is still running.');
      return;
    }
    const canvas = brainCanvas.current;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width && height) brain.current?.resize(width, height);
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      brain.current?.dispose();
      brain.current = null;
    };
  }, [circuit, notify]);

  const paintExport = useCallback(() => {
    if (!arenaCanvas.current || !brainCanvas.current) return null;
    if (!composite.current) {
      composite.current = document.createElement('canvas');
      composite.current.width = 1440;
      composite.current.height = 1000;
    }
    const output = composite.current;
    const ctx = output.getContext('2d');
    if (!ctx) return null;
    const drawView = (
      source: HTMLCanvasElement,
      x: number,
      y: number,
      width: number,
      height: number,
      crop?: { x: number; y: number; width: number; height: number },
    ) => {
      const area = crop ?? { x: 0, y: 0, width: source.width, height: source.height };
      const scale = Math.min(width / area.width, height / area.height);
      const w = area.width * scale,
        h = area.height * scale;
      ctx.drawImage(
        source,
        area.x,
        area.y,
        area.width,
        area.height,
        x + (width - w) / 2,
        y + (height - h) / 2,
        w,
        h,
      );
    };
    const state = painted.current;
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, 1440, 1000);
    ctx.fillStyle = palette.ink;
    ctx.font = 'bold 40px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillText('Swat.', 40, 63);
    ctx.font = '28px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillText('Catch it. If you can.', 164, 61);
    ctx.font = '18px "DM Sans Variable", sans-serif';
    ctx.fillStyle = palette.muted;
    ctx.textAlign = 'right';
    ctx.fillText('Real circuit · Arcade flight', 1396, 60);
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.scene;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(34, 96, 1060, 800, 25);
    ctx.fill();
    ctx.clip();
    drawView(arenaCanvas.current, 34, 96, 1060, 800);
    ctx.restore();
    ctx.fillStyle = palette.brain;
    ctx.beginPath();
    ctx.roundRect(1110, 96, 296, 800, 25);
    ctx.fill();
    ctx.fillStyle = palette.onBrain;
    ctx.font = 'bold 28px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillText('Tiny mind.', 1134, 145);
    drawView(brainCanvas.current, 1120, 171, 276, 480, brain.current?.getExportCrop());
    ctx.fillStyle = palette.lime;
    ctx.font = 'bold 46px "Bricolage Grotesque Variable", sans-serif';
    ctx.fillText(fmt(state.neural.aliveNeurons), 1134, 726);
    ctx.fillStyle = palette.onBrainMuted;
    ctx.font = '18px "DM Sans Variable", sans-serif';
    ctx.fillText('neurons online', 1134, 754);
    ctx.fillText(`${compact(circuitRef.current?.edges.length ?? 0)} real connections`, 1134, 786);
    ctx.font = 'bold 25px "DM Sans Variable", sans-serif';
    ctx.fillStyle = palette.ink;
    ctx.fillText(
      `${state.mode === 'caught' ? `CAUGHT IN ${state.elapsed.toFixed(1)}s` : `${state.elapsed.toFixed(1)}s SURVIVED`}   ·   ${state.swats} SWATS   ·   ${state.dodges} MISSES`,
      40,
      944,
    );
    ctx.font = '16px "DM Sans Variable", sans-serif';
    ctx.fillStyle = palette.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`MaleCNS v1.0 · ${location.host}`, 1398, 980);
    ctx.textAlign = 'left';
    if (replay.current || state.simSpeed < 0.95) {
      ctx.fillStyle = palette.ink;
      ctx.fillRect(53, 116, 286, 37);
      ctx.fillStyle = palette.paper;
      ctx.font = '17px "DM Sans Variable", sans-serif';
      ctx.fillText(
        replay.current
          ? 'SLOW-MOTION REPLAY · 0.4×'
          : `SIMULATION · ${state.simSpeed.toFixed(2)}× SPEED`,
        67,
        141,
      );
    }
    return output;
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastReplayUi = 0;
    let lastExportPaint: number | null = null;
    let fpsStart = last,
      frameCount = 0;
    const tick = (now: number) => {
      // A visible frame can wake a timer-throttled worker. One outstanding
      // heartbeat at most; the worker still owns elapsed time and fixed steps.
      if (
        worker.current &&
        workerHealthy.current &&
        !framePending.current &&
        live.current.mode === 'playing' &&
        !document.hidden &&
        !pausedRef.current &&
        !replay.current &&
        !modalRef.current
      ) {
        framePending.current = true;
        command({ type: 'frame' });
      }
      frameCount++;
      if (now - fpsStart > 1000) {
        setFps(Math.min(240, Math.round((frameCount * 1000) / (now - fpsStart))));
        frameCount = 0;
        fpsStart = now;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      let state = live.current;
      if (replay.current) {
        const frames = replay.current.frames;
        // Replay and its cosmetic tail use the same held/clamped clock. A
        // hidden tab or Help dialog cannot skip past an unseen impact.
        if (!document.hidden && !modalRef.current) replay.current.cursor += dt * 0.4;
        const at = replay.current.cursor;
        const index = frames.findIndex((f) => f.time >= at);
        const finalFrame = frames[frames.length - 1];
        // Hold the real final catch for its cosmetic squash/recoil. No new
        // physics or neural frames are fabricated for this replay tail.
        if (
          index === -1 &&
          finalFrame.mode === 'caught' &&
          at - finalFrame.time < CATCH_PRESENTATION_SECONDS
        ) {
          state = finalFrame;
          if (now - lastReplayUi > 100) {
            setSnapshot(state);
            lastReplayUi = now;
          }
        } else if (index === -1) {
          replay.current = null;
          setReplaying(false);
          setSnapshot(live.current);
          command({
            type: 'pause',
            paused: pausedRef.current || document.hidden || !!modalRef.current,
          });
        } else {
          state = frames[index];
          if (now - lastReplayUi > 100) {
            setSnapshot(state);
            lastReplayUi = now;
          }
        }
      }
      painted.current = state;
      arena.current?.update(state);
      const catchAge = arena.current?.render(dt, {
        rate: replay.current ? 0.4 : 1,
        held: document.hidden || !!modalRef.current,
      });
      const settled =
        state.mode === 'caught' && (catchAge == null || catchAge >= CATCH_PRESENTATION_SECONDS);
      if (settled !== catchSettledRef.current) {
        catchSettledRef.current = settled;
        setCatchSettled(settled);
      }
      brain.current?.update(state);
      brain.current?.render(dt);
      // The recorder captures 30 fps. Avoid drawing two expensive composite
      // frames per captured frame on a 60 Hz display (or more on faster ones).
      if (recorder.current?.state === 'recording') {
        const frameTime = recordingFrameTime(lastExportPaint, now);
        if (frameTime !== null) {
          paintExport();
          lastExportPaint = frameTime;
        }
      } else {
        lastExportPaint = null;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [command, paintExport]);

  useEffect(() => {
    const onVisibility = () =>
      command({
        type: 'pause',
        paused: document.hidden || pausedRef.current || !!replay.current || modal !== null,
      });
    document.addEventListener('visibilitychange', onVisibility);
    if (ready) onVisibility();
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [command, modal, ready]);

  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.onerror = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      releaseRecording.current?.();
    },
    [],
  );

  const endReplay = useCallback(() => {
    replay.current = null;
    setReplaying(false);
  }, []);
  const focusArena = useCallback(
    () => arenaCanvas.current?.parentElement?.focus({ preventScroll: true }),
    [],
  );
  const focusEntry = useCallback(() => {
    if (startButton.current && !startButton.current.disabled)
      startButton.current.focus({ preventScroll: true });
    else arenaCanvas.current?.parentElement?.focus({ preventScroll: true });
  }, []);
  const startRound = useCallback(() => {
    if (!ready || error || modalRef.current) return;
    endReplay();
    replayFrames.current = [];
    setHasReplay(false);
    setPaused(false);
    pausedRef.current = false;
    highlightFrames.current = [];
    highlightUntil.current = -Infinity;
    aimRef.current.active = false;
    command({ type: 'pointer', x: 500, y: 325, active: false });
    command({ type: 'pause', paused: false });
    command({ type: 'start' });
    focusArena();
  }, [command, ready, error, endReplay, focusArena]);
  const reset = useCallback(() => {
    endReplay();
    setPaused(false);
    pausedRef.current = false;
    command({ type: 'pause', paused: false });
    command({ type: 'reset' });
    replayFrames.current = [];
    setHasReplay(false);
    highlightFrames.current = [];
    highlightUntil.current = -Infinity;
    aimRef.current.active = false;
    focusArena();
  }, [command, endReplay, focusArena]);
  const swat = useCallback(() => {
    if (
      modalRef.current ||
      live.current.mode !== 'playing' ||
      pausedRef.current ||
      replay.current ||
      !aimRef.current.active ||
      live.current.swatCooldown > 0
    )
      return;
    command({ type: 'swat' });
  }, [command]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Native dialog cancellation owns Escape. Game shortcuts never bypass
      // the initial acknowledgement or fire behind an open modal.
      if (modal) return;
      const target = event.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, [role="dialog"]')) return;
      if (event.code === 'Space' && !modal) {
        event.preventDefault();
        if (live.current.mode !== 'playing') startRound();
        else swat();
      }
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
        !modal &&
        live.current.mode === 'playing' &&
        !replay.current
      ) {
        event.preventDefault();
        const aim = aimRef.current.active ? aimRef.current : { x: 500, y: 325 };
        aimRef.current = {
          x: Math.max(
            0,
            Math.min(
              1000,
              aim.x + (event.key === 'ArrowLeft' ? -35 : event.key === 'ArrowRight' ? 35 : 0),
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              650,
              aim.y + (event.key === 'ArrowUp' ? -35 : event.key === 'ArrowDown' ? 35 : 0),
            ),
          ),
          active: true,
        };
        command({ type: 'pointer', ...aimRef.current });
      }
      if (event.key.toLowerCase() === 'r' && !modal) reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startRound, swat, reset, modal, command]);

  const setPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      modalRef.current ||
      replay.current ||
      !arena.current ||
      (event.target as HTMLElement).closest('button')
    )
      return;
    const point = arena.current.screenToWorld(event.clientX, event.clientY);
    aimRef.current = { ...point, active: true };
    if (event.pointerType === 'touch') setTouchUsed(true);
    command({ type: 'pointer', ...aimRef.current });
  };
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    command({ type: 'pause', paused: next });
    focusArena();
  };
  const startReplay = () => {
    if (replayFrames.current.length < 3) return;
    const highlight = highlightFrames.current.length >= 3;
    const frames = highlight ? highlightFrames.current : replayFrames.current.slice(-90);
    replay.current = {
      frames,
      cursor: frames[0].time,
      label: highlight ? 'Last swat' : 'Last seconds',
    };
    setReplaying(true);
    command({ type: 'pause', paused: true });
  };
  const saveImage = () => {
    arena.current?.render(0);
    brain.current?.render(0);
    const canvas = paintExport();
    canvas?.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'swat-snapshot.png');
    }, 'image/png');
  };
  const toggleRecord = () => {
    if (recorder.current) {
      if (recorder.current.state === 'recording') recorder.current.stop();
      return;
    }
    if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) {
      saveImage();
      notify('Video capture isn’t supported here. Saved a snapshot instead.');
      return;
    }
    const output = paintExport();
    if (!output) return;
    const mime = ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    if (!mime) {
      saveImage();
      notify('Saved a snapshot. This browser doesn’t support video export.');
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = output.captureStream(30);
      const recording = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 5_000_000,
      });
      recorder.current = recording;
      const chunks: BlobPart[] = [];
      recording.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const timer = setTimeout(() => {
        if (recording.state === 'recording') recording.stop();
      }, 30_000);
      const cleanup = () => {
        clearTimeout(timer);
        stream?.getTracks().forEach((track) => {
          track.stop();
        });
        releaseRecording.current = null;
      };
      releaseRecording.current = cleanup;
      recording.onstop = () => {
        cleanup();
        setRecording(false);
        downloadBlob(
          new Blob(chunks, { type: mime }),
          `swat-replay.${mime.includes('mp4') ? 'mp4' : 'webm'}`,
        );
        notify('Your clip is ready. Tiny brain, big screen debut.');
        recorder.current = null;
      };
      recording.onerror = () => {
        recording.onstop = null;
        cleanup();
        setRecording(false);
        recorder.current = null;
        notify('The recording couldn’t finish. You can still save a snapshot.');
      };
      recording.start(1000);
      setRecording(true);
      notify('Recording both views. Stop any time, or we’ll stop after 30 seconds.');
    } catch {
      stream?.getTracks().forEach((track) => {
        track.stop();
      });
      releaseRecording.current?.();
      recorder.current = null;
      setRecording(false);
      saveImage();
      notify('Video export couldn’t start. Saved a snapshot instead.');
    }
  };

  const timeLeft = Math.max(0, snapshot.duration - snapshot.elapsed);
  const result = snapshot.mode === 'caught' || snapshot.mode === 'escaped';
  const intro = snapshot.mode === 'ready';
  const populations = useMemo(() => {
    const groups = [
      { label: 'Vision', role: 'sensory', color: neuralColors.vision, sum: 0, count: 0, active: 0 },
      {
        label: 'Network',
        role: 'interneuron',
        color: neuralColors.network,
        sum: 0,
        count: 0,
        active: 0,
      },
      {
        label: 'Escape',
        role: 'descending',
        color: neuralColors.escape,
        sum: 0,
        count: 0,
        active: 0,
      },
    ];
    circuit?.neurons.forEach((cell, index) => {
      if (snapshot.neural.disabled[index]) return;
      const group = groups[cell.type === 'LC16' ? 0 : cell.type === 'MDN' ? 2 : 1];
      const value = snapshot.neural.activity[index] || 0;
      group.sum += value;
      group.count++;
      if (value > 0.1) group.active++;
    });
    return groups;
  }, [circuit, snapshot.neural]);
  const activeNeurons = populations.reduce((total, group) => total + group.active, 0);
  const selectedIndex =
    selectedNeuron && circuit
      ? circuit.neurons.findIndex((cell) => cell.id === selectedNeuron.id)
      : -1;
  const selectedActivity = selectedIndex >= 0 ? snapshot.neural.activity[selectedIndex] || 0 : 0;
  const flightLabel = intro
    ? 'Ready'
    : paused
      ? 'Paused'
      : result
        ? snapshot.mode === 'caught'
          ? 'Caught'
          : 'Escaped'
        : snapshot.fly.flightState === 'evading'
          ? 'Evading'
          : snapshot.fly.flightState === 'darting'
            ? 'Darting'
            : 'Flying';
  return (
    <>
      <main>
        <h1 className="sr-only">Swat. Catch it, if you can.</h1>
        <section className="experiment-layout" aria-label="Fly game and live neural activity">
          <div className="arena-card">
            <div className="panel-heading">
              <a className="brand-link" href="/" aria-label="Swat home">
                <Brand small />
              </a>
              <div className="arena-tools">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="How to play"
                  onClick={() => setModal('help')}
                >
                  <CircleHelp size={17} />
                </button>
              </div>
            </div>
            {/* biome-ignore lint/a11y/useSemanticElements: This canvas game group is not a form fieldset. */}
            <div
              className={`arena-viewport${intro ? ' is-ready' : ''}`}
              role="group"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: The game needs a focus target for its documented arrow and Space controls.
              tabIndex={0}
              aria-label="Side-on fly arena. Move to aim, click or press Space to swat."
              onPointerMove={setPointer}
              onPointerLeave={(event) => {
                if (!replay.current && event.pointerType !== 'touch') {
                  aimRef.current.active = false;
                  command({ type: 'pointer', x: 0, y: 0, active: false });
                }
              }}
              onPointerDown={(event) => {
                if ((event.target as HTMLElement).closest('button')) return;
                setPointer(event);
                if (event.pointerType !== 'touch') swat();
              }}
            >
              <canvas
                className="arena-canvas"
                ref={arenaCanvas}
                aria-label="Side view of a cartoon fruit fly darting through an airy blue flight window"
              />
              {!intro && (
                <span className={`flight-state state-${snapshot.fly.flightState || 'cruising'}`}>
                  {flightLabel}
                </span>
              )}
              {snapshot.mode === 'playing' && snapshot.simSpeed < 0.85 && (
                <span className="sim-speed">
                  Running at {snapshot.simSpeed.toFixed(2)}× —{' '}
                  {recording ? 'stop recording to lighten the load' : 'your device is catching up'}
                </span>
              )}
              {intro && !error && (
                <div className="start-overlay">
                  <button
                    type="button"
                    ref={startButton}
                    className="primary-button start-button"
                    onClick={startRound}
                    disabled={!ready}
                  >
                    {ready ? (
                      <>
                        <Play size={20} fill="currentColor" />
                        Catch this fly
                      </>
                    ) : (
                      <>
                        <LoaderCircle className="spin" size={19} />
                        {modelStatus}
                      </>
                    )}
                  </button>
                  <span>30 seconds. Lead the fly.</span>
                </div>
              )}
              {error && (
                <div className="error-overlay" role="alert">
                  <strong>The game needs a restart.</strong>
                  <p>{error}</p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={recording}
                    onClick={() => location.reload()}
                  >
                    {recording ? 'Stop recording to reload' : 'Reload game'}
                  </button>
                </div>
              )}
              {paused && !result && !intro && !replaying && (
                <div className="pause-overlay">
                  <h2>Paused</h2>
                  <button
                    type="button"
                    className="primary-button play-button"
                    onClick={togglePause}
                  >
                    <Play size={18} />
                    Resume
                  </button>
                </div>
              )}
              {result && !replaying && (snapshot.mode !== 'caught' || catchSettled) && (
                <div
                  className={`result-overlay${snapshot.mode === 'caught' ? ' result-caught' : ''}`}
                >
                  <span className="result-icon">
                    {snapshot.mode === 'caught' ? <Focus size={30} /> : <Sparkles size={30} />}
                  </span>
                  <h2>{snapshot.mode === 'caught' ? 'Gotcha!' : 'Fly wins.'}</h2>
                  <p>
                    {snapshot.mode === 'caught'
                      ? `${snapshot.elapsed.toFixed(1)}s · ${snapshot.swats} swat${snapshot.swats === 1 ? '' : 's'}`
                      : `${snapshot.dodges} miss${snapshot.dodges === 1 ? '' : 'es'}. One very smug fly.`}
                  </p>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="primary-button play-button"
                      onClick={startRound}
                    >
                      <RotateCcw size={17} />
                      Rematch
                    </button>
                    <button type="button" className="secondary-button" onClick={saveImage}>
                      <Download size={17} />
                      Save
                    </button>
                  </div>
                  {hasReplay && (
                    <button
                      type="button"
                      className="text-button replay-button"
                      onClick={startReplay}
                    >
                      <Film size={16} />
                      Slow-mo replay
                    </button>
                  )}
                </div>
              )}
              {replaying && (
                <div className="replay-badge">
                  <Film size={16} />
                  {replay.current?.label} · 0.4×
                  <button
                    type="button"
                    onClick={() => {
                      endReplay();
                      command({ type: 'pause', paused: pausedRef.current });
                      setSnapshot(live.current);
                    }}
                  >
                    Exit replay <X size={14} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className={`mobile-swat${touchUsed ? ' touch-visible' : ''}`}
                disabled={
                  snapshot.mode !== 'playing' || paused || replaying || snapshot.swatCooldown > 0
                }
                onPointerDown={(event) => event.stopPropagation()}
                onClick={swat}
              >
                <Focus size={21} />
                SWAT
              </button>
            </div>
            <div className="arena-bottom">
              <div className="score-stat">
                <span>TIME</span>
                <strong className={timeLeft < 6 && snapshot.mode === 'playing' ? 'time-low' : ''}>
                  {String(Math.ceil(timeLeft)).padStart(2, '0')}
                  <small>s</small>
                </strong>
              </div>
              <div className="score-stat">
                <span>SWATS</span>
                <strong>{String(snapshot.swats).padStart(2, '0')}</strong>
              </div>
              <div className="score-stat">
                <span>MISSES</span>
                <strong>{String(snapshot.dodges).padStart(2, '0')}</strong>
              </div>
              <div className="round-controls">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Reset game"
                  title="Reset (R)"
                  onClick={reset}
                  disabled={!ready}
                >
                  <RotateCcw size={19} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={paused ? 'Resume game' : 'Pause game'}
                  onClick={togglePause}
                  disabled={!ready || intro || result || replaying}
                >
                  {paused ? <Play size={19} /> : <Pause size={19} />}
                </button>
              </div>
            </div>
            <div className="play-controls">
              <p>
                <MousePointer2 size={16} />
                <span className="desktop-instruction">Click ahead · ¼-second swing</span>
                <span className="touch-instruction">Drag ahead. Tap SWAT.</span>
              </p>
              <div className="export-controls">
                <button
                  type="button"
                  className={`text-button${recording ? ' is-recording' : ''}`}
                  onClick={toggleRecord}
                  disabled={!ready && !recording}
                >
                  <span className="record-dot" />
                  {recording ? 'Stop recording' : 'Record clip'}
                </button>
                <button type="button" className="text-button" onClick={saveImage} disabled={!ready}>
                  <Download size={16} />
                  Snapshot
                </button>
              </div>
              <div className="performance">
                <span className={fps < 35 ? 'performance-warn' : ''}>{fps} fps</span>
                <span>
                  {snapshot.mode === 'playing'
                    ? `${snapshot.simSpeed.toFixed(2)}× sim`
                    : 'On-device'}
                </span>
              </div>
            </div>
          </div>

          <aside className="brain-card" aria-label="Live neural circuit">
            <div className="panel-heading brain-heading">
              <h2>
                Tiny mind<span>.</span>
              </h2>
            </div>
            <div className="brain-view">
              <canvas
                ref={brainCanvas}
                aria-label="Real neuron positions, glowing with their actual simulated firing"
                onPointerDown={(event) => {
                  brainGesture.current = [event.clientX, event.clientY];
                }}
                onPointerUp={(event) => {
                  const start = brainGesture.current;
                  if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) < 5)
                    setSelectedNeuron(brain.current?.pick(event.clientX, event.clientY) ?? null);
                  brainGesture.current = null;
                }}
              />
              {!circuit && (
                <span className="brain-loading">
                  <LoaderCircle size={25} className="spin" />
                  {modelStatus}
                </span>
              )}
              <div className="brain-live-count">
                <strong>{fmt(activeNeurons)}</strong>
                <span>recently active</span>
              </div>
              {selectedNeuron && (
                <div className="neuron-tag">
                  <strong>
                    {selectedNeuron.type || 'Neuron'} · {selectedNeuron.side}
                  </strong>
                  <span>
                    Cell {selectedNeuron.id} · {Math.round(selectedActivity * 100)}% recent activity
                  </span>
                  <button
                    type="button"
                    aria-label="Close neuron details"
                    onClick={() => setSelectedNeuron(null)}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <span className="brain-orbit-hint">Drag to rotate · tap a neuron</span>
            </div>
            <section className="population-strip" aria-label="Recent neural activity by population">
              {populations.map((group) => (
                <div
                  className="population"
                  key={group.role}
                  style={{ '--population-color': group.color } as React.CSSProperties}
                  title={`${group.active} of ${group.count} enabled neurons recently active`}
                >
                  <span>
                    <i />
                    {group.label}
                  </span>
                  <div className="population-meter">
                    <i
                      style={{
                        width: `${group.count ? Math.min(100, (group.sum / group.count) * 250) : 0}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {group.active}
                    <small> / {group.count}</small>
                  </strong>
                </div>
              ))}
            </section>
            <section className="circuit-readout" aria-label="Fully enabled real circuit">
              <div>
                <strong>{circuit ? fmt(circuit.neurons.length) : '—'}</strong>
                <span>neurons</span>
              </div>
              <div>
                <strong>{circuit ? compact(circuit.edges.length) : '—'}</strong>
                <span>real connections</span>
              </div>
            </section>
            <footer className="brain-footer">
              <button type="button" className="text-button" onClick={() => setModal('about')}>
                Real circuit. Arcade flight. <CircleHelp size={14} />
              </button>
              <a href="https://male-cns.janelia.org/" target="_blank" rel="noreferrer">
                MaleCNS · CC BY 4.0 <ArrowUpRight size={12} />
              </a>
            </footer>
          </aside>
        </section>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <InfoModal
          kind={modal}
          circuit={circuit}
          onClose={() => setModal(null)}
          onEntered={focusEntry}
        />
      )}
    </>
  );
}

function compact(number: number) {
  return number >= 1_000_000
    ? `${(number / 1_000_000).toFixed(2)}M`
    : number >= 1000
      ? `${(number / 1000).toFixed(number >= 100_000 ? 0 : 1)}k`
      : fmt(number);
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
