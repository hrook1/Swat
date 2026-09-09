# Contributing to Swat

Swat is a small browser game with an explicit scientific boundary: real connectome data, simplified neuron dynamics, and arcade movement. Contributions should keep it fun to play and clear about what the model does.

## Development

Use Node.js 24 and the committed npm lockfile:

```sh
npm ci
npm run dev
```

Keep changes focused. Tests live beside their modules; shared colours belong in `src/theme/palette.ts`, and worker messages and snapshots belong in `src/shared/types.ts`. See [the architecture guide](docs/architecture.md) before changing simulation, timing or recording.

Run the complete checks before opening a pull request:

```sh
npm run verify
```

Useful individual commands:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run format
npm test
npm run test:watch
npm run check:security
```

`format` changes files; the other format command only reports differences. Do not commit `node_modules`, build output, raw connectome downloads, recordings, local environment files or hosting account configuration.

## Pull requests

Describe the problem, the change and how you checked it. Include screenshots or a short clip for visual changes, and specify browser, viewport and input method when reporting an interaction issue. Add regression tests for bug fixes where practical.

Before requesting review:

- Run the checks and inspect the exact diff, including newly added files.
- Exercise the affected path in a real browser; unit tests do not verify visual polish or touchscreen feel.
- Check a narrow viewport and keyboard navigation for UI changes.
- Preserve existing data attribution, manifest provenance and source checksums.
- Keep dependency and formatting-only changes separate from unrelated gameplay changes.

Never include tokens, passwords, private keys, personal filesystem paths, private deployment identifiers or private user data in code, logs, screenshots or issue reports. Automated secret checks are a guardrail, not proof that a diff contains no sensitive information. Do not report a suspected credential publicly; use the repository's private security-reporting channel where available.

## Model and data changes

Document changes to neuron selection, connection weights, transmitter assumptions, integration timing, sensory inputs or the motor decoder. Distinguish observed anatomy from modelling choices and game rules. Changing these can affect both neural activity and gameplay.

Prepared graphs are versioned artifacts. Regenerate them with the extraction scripts, retain the manifests and attribution, and run graph-integrity and stimulus checks. Do not hand-edit a large graph to make a test pass. Ordinary UI work does not need raw data downloads or Python.

Do not describe increased speed, more neurons or larger gains as learned intelligence. Any claim that training improves evasion needs a separate, reproducible experiment with held-out encounters and clear baselines. No learned controller is shipped today.

## Scope

Bug fixes, clearer instructions, responsive layout improvements, performance measurements and focused test coverage are good starting points. Discuss major dependency additions, new services, alternate neural models or changes to capture rules before implementing them. Hosting credentials and public release actions stay with the repository maintainer.
