# Architecture

Swat is a static, client-side TypeScript application. React owns the interface, Three.js renders the game and neural view, and a Web Worker owns the simulation. There is no application server, database, remote inference call or runtime API key.

## Runtime ownership

| Layer                          | Owns                                                                                   | Does not own                                       |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/App.tsx`                  | Loading, UI state, player input, rendering loop, replay snapshots and recording        | Neural integration or collision outcomes           |
| `src/components/InfoModal.tsx` | Welcome, help, model explanations and dialog focus                                     | Starting a round or processing game input          |
| `src/game/game.worker.ts`      | Worker lifecycle, commands and publishing snapshots                                    | DOM, rendering or media capture                    |
| `src/game/scheduler.ts`        | One elapsed-time ledger and bounded fixed-step work                                    | Variable neural timesteps or invented elapsed time |
| `src/game/Game.ts`             | Round state, seeded movement, sensory features, pending swats and collision resolution | Visual effects or a learned policy                 |
| `src/neural/Brain.ts`          | Sparse connectivity, membrane/current state, spikes and neural readouts                | Cursor position, hit targets or flight geometry    |
| `src/render/`                  | Arena, fly, swatter, splat and brain visualization                                     | Changing the result of a swat                      |

The active graph is `public/data/circuit-expanded.json`: 6,000 cells and 1,275,994 directed edges. The UI loads it once and initializes the worker. Smaller prepared graphs and lesion commands remain available to tests and offline model probes, but have no player-facing controls.

## The sensory-to-action boundary

The game converts the swatter's position relative to the fly into synthetic looming features: angular size, approach and left/right bearing. An in-progress swing expands an engineered apparent radius. This is a feature-based approximation, not rendered-image perception or a reconstruction of the fly's eyes.

Only the bilateral LC16 looming channels drive the model. `frontLoom` and motion channels exist in the shared interface but are not currently used by the neural kernel. Spikes propagate over the retained anatomical graph; the decoder reads the four annotated MDNs and turns their filtered rates into retreat and turning signals.

Those signals modulate an authored flight controller. Baseline cruising, randomly seeded direction changes, bounds and body animation are separate game mechanics. The baseline movement's random stream does not inspect the cursor; the neural kernel never receives a precomputed escape direction. This separation is covered by regression tests, but does not establish a biologically faithful airborne escape circuit.

## Time and collision rules

The worker advances the world in 1 ms steps. Timers and coalesced animation-frame wakeups share one scheduler, so extra wakeups cannot double the simulated elapsed time. Work is budgeted and accumulated wall-time debt is capped; a slow device reports reduced simulation speed instead of silently increasing the neural timestep.

A swat locks its target at the accepted input event. Collision resolves 240 ms later against the fly's projected body centre, using the game's fixed 57-unit catch radius in a 1,000 × 650 world. The cooldown is 560 ms from the accepted input. A click on the current fly position can therefore miss if the fly moves before impact. The side-on scene's decorative depth does not add a hidden collision dimension.

Only a confirmed collision triggers the splat. `SwatVisualState` and `CatchVisualState` keep presentation time separate from the outcome: the animation cannot award a hit. Projection and timing tests protect that contract.

## Interface lifecycle

Every fresh page load begins with a welcome dialog. Only **Let's go** acknowledges it; the user starts the round separately. Game input is blocked while a dialog is open. The `?` help dialog can be dismissed normally and restores focus to its invoking control.

The worker pauses for explicit pause, an open dialog, a hidden page or replay. Reset clears the current round and restores the initial seed. Rematch generates a new seeded route. A seed reproduces initial conditions; a human encounter additionally depends on the timing of all pointer and swat inputs.

Renderers, resize observers, worker timers, recording tracks and pending UI resources have explicit cleanup paths. Fatal worker errors stop integration and require reinitialization rather than allowing later input to resume damaged state.

## Neural visualization

Tiny mind uses retained neurons' anatomical soma coordinates and sampled graph edges. It does not reconstruct axons. The expanded graph has 24 cells without source soma positions; these use central placeholders identified in the manifest.

Activity comes from the numerical model's recent activity values. Role colours distinguish sensory LC16 cells, descending MDNs and other retained neurons. Display sampling reduces the number of connection lines drawn, not the number of edges simulated. The state arrays in snapshots are owned copies, so later integration does not mutate saved replay activity.

## Replay and recording

The UI keeps bounded histories of pose and neural snapshots during a round and records a window around the latest accepted swat. Slow-motion replay uses those samples at 0.4× speed; it is not a new neural simulation. The final catch presentation can finish its visual animation without inventing additional physics or neural samples.

Recording composites both WebGL canvases with labels onto a 1,440 × 1,000 canvas and captures it at up to 30 fps using the browser's `MediaRecorder`. Clips are silent, download locally, and stop after 30 seconds unless stopped earlier. MP4 is preferred if supported, followed by WebM; unsupported capture falls back to a PNG snapshot. Neither the application nor a backend uploads these recordings.

## Data and reproducibility

Each circuit manifest records the dataset version, source URLs and SHA-256 hashes, selected neuron IDs, edge/contact counts, selection rules, boundary cuts, missing positions and model assumptions. `public/data/circuits.json` describes the nested prepared graphs; calibration files contain synthetic model outputs, not physiological recordings.

The [neural guide](../src/neural/README.md) documents reproduction. The extraction path downloads roughly 1.2 GB of official source tables and needs a separate Python environment. Normal web development, tests and production builds use the prepared files instead.

Changing graph selection or model parameters changes the scientific artifact. Regenerate manifests and calibration deliberately, record the reason, and inspect the diff. A passing regression suite does not prove that the real fly would behave the same way.

## Build and deploy

Use `npm ci` with Node.js 24, then `npm run verify`. `npm run build` writes static assets to `dist/`; `npm run preview` serves that output for a production-style local check. Vercel can use `npm run build` as its build command and `dist` as its output directory. Keep raw data preparation outside the hosting build.

The application fetches its graph from the same origin. It does not require application secrets, a database or a server function. Hosting account configuration, authentication files, local environment files, raw data and generated recordings must remain outside the public repository. Dependency auditing and secret scanning reduce risk but do not constitute a security certification.

## Release checklist

Automated checks and hands-on checks cover different failure modes. Before a release:

1. Run `npm run verify`; review dependency-audit findings and the exact files being published.
2. Open the production build in a recent desktop browser. Check welcome acknowledgement, start, hover response, swats, misses, a catch, pause, reset and rematch.
3. Check keyboard focus and input, a narrow viewport, modal scrolling and reachable touch controls. Test on real touch hardware before making touch-playability claims.
4. Check Tiny mind activity, neuron inspection, slow-motion replay and recording/snapshot downloads on a browser supporting them.
5. Watch for console errors and reduced simulation speed. Recheck the deployed origin after publishing, including the circuit fetch and welcome screen.

The optional soak suite exercises longer simulated sessions. Node throughput, a browser frame-rate counter, and actual player experience are distinct measurements; report them separately and identify the hardware/browser when sharing performance results.
