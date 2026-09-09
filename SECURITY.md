# Security and privacy

## Reporting a vulnerability

Please do not put credentials, exploit details or private information in a public issue or pull request.

If this repository's **Security → Advisories → Report a vulnerability** option is available, use it to send a private report. Include the affected version, minimal reproduction steps and expected impact. Do not include real credentials or other people's data. If private reporting is unavailable, request that the maintainer enable a private reporting channel without disclosing the vulnerability publicly. No response-time guarantee is offered.

Security fixes target the current default branch; older snapshots are not maintained separately.

## What the game does

Swat is a static browser game. The current application downloads its public circuit JSON and bundled assets from the same site, then runs the simulation in a browser worker. It does not include an application server, accounts, a database, an analytics SDK or an external AI API. No API keys are required to play or build it.

Pointer input, neural activity and short replay buffers stay in the page's memory. The application does not write them to browser persistent storage or upload them. A numeric URL seed can select an initial simulation seed; it is not an account or access credential. Reloading discards the in-memory run.

Recording captures the game's own canvas, not the user's screen, camera or microphone. Clips and snapshots are created locally and downloaded only on request. The application does not upload those files. A user who shares a downloaded file is responsible for its destination.

These statements describe the application code, not the hosting provider, browser extensions or a modified deployment. The web host can receive normal HTTP request metadata, including IP addresses and request URLs. Visiting the external research and license links is also subject to those sites' practices. Self-hosters should disclose any additional logging or tracking they add.

## Data and trust boundaries

The distributed connectome files contain public scientific neuron annotations, coordinates and connection counts, not user records. Preserve the scientific attribution and license information in [public/data/ATTRIBUTION.md](public/data/ATTRIBUTION.md).

The bundled circuit is a trusted application asset. Although the simulator checks important structure and numeric values, it is not a hardened importer for arbitrary user-supplied graphs. Large or malformed replacement files can exhaust memory or processing time. There is no supported file-upload feature. The visual simulation and its inferred neural parameters are not a medical, behavioral or biological validation service.

Use HTTPS for public hosting. A browser worker isolates scheduling, not trust: code and data from the site's origin remain part of the same application. Protect deployment access and review dependencies and changes before publishing.

## Public-release checks

Never commit local environment files, credentials, deployment account metadata, raw download caches, virtual environments, build output or personal recordings. The `.gitignore` file is a convenience, not a safeguard for files already tracked by Git. Do not put private values in browser-side environment variables; a static bundle is public.

After staging the intended public files, run:

```sh
node --test scripts/check-public-release.test.mjs
node scripts/check-public-release.mjs
```

The second command scans Git's index blobs, including previously tracked files, rather than trusting the working tree. It rejects private/generated paths, symlinks, submodules, unsupported binary files, likely credential patterns, workstation home paths and deployment identifiers. It limits individual indexed files to 25 MiB and the inspected content to 100 MiB. Public neuron IDs, synapse counts and dependency hashes are not treated as secrets merely because they are long.

Findings print only filenames and rule names, never the matching value. Sensitive filenames are rejected without opening their contents. Correct or unstage each finding, then stage and check again. The scanner does not modify files or Git state.

This is a lightweight release guard, not a comprehensive secret detector or penetration test. It does not inspect previous Git history, untracked files, binary-asset metadata, hosting configuration or dependency vulnerabilities. Review the complete staged diff, run the application tests/build, inspect the built site, and use dependency and hosting security checks as well. If a real credential has ever been published, revoke or rotate it; deleting its latest copy is not enough.
