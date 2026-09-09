import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { canDismissInfo, type InfoModalDismissal, type InfoModalKind } from '../shared/infoModal';
import type { CircuitData } from '../shared/types';

const fmt = (value: number) => new Intl.NumberFormat('en').format(value);

export function InfoModal({
  kind,
  circuit,
  onClose,
  onEntered,
}: {
  kind: InfoModalKind;
  circuit: CircuitData | null;
  onClose: () => void;
  onEntered?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const acknowledged = useRef(false);
  closeRef.current = onClose;
  useEffect(() => {
    const invoker = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    // Register directly before showModal: native cancellation must be stopped
    // synchronously, including on browsers without closedby support.
    const cancel = (event: Event) => {
      event.preventDefault();
      if (canDismissInfo(kind, 'escape')) closeRef.current();
    };
    element?.addEventListener('cancel', cancel);
    element?.showModal();
    if (kind === 'welcome') {
      if (element) element.scrollTop = 0;
      heading.current?.focus({ preventScroll: true });
    }
    return () => {
      element?.removeEventListener('cancel', cancel);
      element?.close();
      if (kind === 'welcome') {
        if (acknowledged.current) onEntered?.();
      } else if (invoker?.isConnected) invoker.focus({ preventScroll: true });
    };
  }, [kind, onEntered]);
  const dismiss = (reason: InfoModalDismissal) => {
    if (!canDismissInfo(kind, reason)) return;
    if (kind === 'welcome' && reason === 'continue') acknowledged.current = true;
    onClose();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop dismissal has native Escape cancellation and keyboard-accessible close/continue buttons.
    <dialog
      ref={dialog}
      className="info-dialog"
      closedby={kind === 'welcome' ? 'none' : 'closerequest'}
      aria-labelledby="dialog-title"
      onClick={(event) => {
        if (event.target === dialog.current) dismiss('backdrop');
      }}
    >
      <div className="dialog-content">
        {kind !== 'welcome' && (
          <button
            type="button"
            className="icon-button dialog-close"
            onClick={() => dismiss('close')}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        )}
        <h2 id="dialog-title" ref={heading} tabIndex={kind === 'welcome' ? -1 : undefined}>
          {kind === 'about'
            ? 'Real wiring. Arcade flying.'
            : kind === 'welcome'
              ? 'Welcome to Swat.'
              : 'Catch the fly.'}
        </h2>
        {kind === 'about' ? (
          <>
            <p>
              Real MaleCNS neurons power the escape signal. The fly's cruising, flight physics and
              wing animation are game code—not a biological flight simulation. This is a side-on,
              two-dimensional game: the fly's visible body is always where you aim.
            </p>
            <div className="dialog-stat-row">
              <span>
                <b>{circuit ? fmt(circuit.neurons.length) : '—'}</b>simulated neurons
              </span>
              <span>
                <b>{circuit ? fmt(circuit.edges.length) : '—'}</b>real connections
              </span>
            </div>
            <p>
              Coral: LC16 visual inputs. Purple: the surrounding network. Lime: the four MDN neurons
              whose output changes the flight's escape burst and turn. Brightness is recent
              simulated firing, not invented animation.
            </p>
            <p>
              The largest prepared circuit is always loaded, with every neuron enabled. That's 6,000
              cells and 1,275,994 observed connections—not the entire fly brain, and not a claim of
              human-like intelligence. Everything runs on your device.
            </p>
            <details>
              <summary>Model assumptions and source notes</summary>
              <p>
                These are cell-body positions and sampled observed connections, not axon
                reconstructions. Neuron electrical behaviour, vision and the flight decoder are
                simplified. Missing coordinates use central placeholders; the loaded model records
                its omissions.
              </p>
              <ul>
                {(circuit?.manifest.assumptions || []).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
            <p className="attribution">
              MaleCNS v1.0 · FlyEM at HHMI Janelia, University of Cambridge, MRC Laboratory of
              Molecular Biology and Google Research. Adapted under{' '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
              .
            </p>
            <a
              className="external-link"
              href="https://male-cns.janelia.org/"
              target="_blank"
              rel="noreferrer"
            >
              Original dataset <ArrowUpRight size={15} />
            </a>
          </>
        ) : (
          <>
            <ol className="help-steps">
              <li>
                <strong>Lead the fly.</strong> Clicking locks the marked spot. Your swat lands about
                a quarter-second later (240 milliseconds), so the fly can move out of the way. The
                flash marks the actual impact.
              </li>
              <li>
                <strong>Mouse:</strong> move and click. <strong>Touch:</strong> drag to aim, then
                tap SWAT. <strong>Keyboard:</strong> arrows to aim, <kbd>Space</kbd> to swat,{' '}
                <kbd>R</kbd> to reset.
              </li>
              <li>
                <strong>One swing at a time.</strong> The swatter is ready again just over half a
                second after your click. Ordinary flying can also cause a miss.
              </li>
              <li>
                <strong>Watch Tiny mind.</strong> During play, the fly uses simulated vision to
                sense your swatter. Move it closer and its neurons can light up as it reacts—even
                before you click.
              </li>
            </ol>
            <button
              type="button"
              className={`primary-button${kind === 'welcome' ? ' play-button' : ''}`}
              onClick={() => dismiss('continue')}
            >
              Let’s go <ArrowUpRight size={17} />
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
