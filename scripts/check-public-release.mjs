#!/usr/bin/env node
/** Review the Git index, not just working files. Never print matching values. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const forbiddenDirectories = new Set([
  '.git',
  '.vercel',
  '.venv',
  'venv',
  'node_modules',
  '__pycache__',
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.codex',
  '.agents',
  '.openai',
  '.local',
  '.direnv',
  '.secrets',
]);
const forbiddenNames =
  /^(?:\.env.*|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.DS_Store|(?:auth|credentials?|tokens?|secrets?)(?:\.[^.]+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|(?:service[-_]?account|private[-_]?key)(?:[-_.].*)?)$/i;
const forbiddenExtensions =
  /\.(?:pem|key|p8|p12|pfx|jks|keystore|feather|parquet|sqlite3?|db|log|tsbuildinfo|zip|tar|gz|tgz|7z|mp4|webm|mov)$/i;
const binaryAssets = /^public\/.*\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;

export function inspectPath(filename, mode = '100644') {
  const findings = [];
  const parts = filename.split('/');
  if (
    !filename ||
    filename.startsWith('/') ||
    parts.includes('..') ||
    filename.includes('\\') ||
    [...filename].some((character) => character.charCodeAt(0) < 32)
  )
    findings.push('unsafe-path');
  if (
    parts.some((part) => forbiddenDirectories.has(part)) ||
    /^(?:data\/raw|artifacts|dist|coverage|\.idea|\.vscode)(?:\/|$)/.test(filename)
  )
    findings.push('private-or-generated-directory');
  if (forbiddenNames.test(parts.at(-1) ?? '') || forbiddenExtensions.test(filename))
    findings.push('sensitive-or-generated-file');
  if (!['100644', '100755'].includes(mode)) findings.push('symlink-submodule-or-unsupported-mode');
  return findings;
}

// Deliberately no generic high-entropy rule: scientific IDs and lockfile hashes
// are expected public content. Specific token formats and assignments are used.
const contentRules = [
  ['private-key-material', /-----BEGIN (?:(?:[A-Z0-9]+ )?PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['service-api-key', /\bsk-(?:proj-|ant-api[0-9]+-)?[A-Za-z0-9_-]{24,}\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['stripe-live-key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{30,}\b/],
  ['jwt-token', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  [
    'credential-in-url',
    /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:[^\s/@]+@/i,
  ],
  ['hardcoded-bearer-token', /\bBearer\s+[A-Za-z0-9_+/.=-]{20,}/],
  ['deployment-identifier', /\b(?:prj|team|dpl)_[A-Za-z0-9]{16,}\b/],
  [
    'workstation-home-path',
    /(?:\/Users\/[^/\s<>]+\/|\/home\/[^/\s<>]+\/|[A-Z]:\\Users\\[^\\\s<>]+\\|\/private\/var\/folders\/)/i,
  ],
];
const credentialAssignment =
  /\b(?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|secret|token)["']?\s*[:=]\s*["']([^"'\r\n]{6,})["']/gi;
const placeholder =
  /^(?:<[^>]+>|\$\{[^}]+\}|(?:YOUR|EXAMPLE|DUMMY|REPLACE)[A-Z0-9_-]*|(?:your|example|dummy|replace)[a-z0-9_-]*)$/;

export function inspectContent(filename, bytes) {
  if (bytes.length > MAX_FILE_BYTES) return ['file-exceeds-25-MiB'];
  // Binary assets still receive filename and size checks. Their embedded
  // metadata is outside this lightweight text scanner's coverage.
  if (binaryAssets.test(filename)) return [];
  if (bytes.includes(0)) return ['unreviewed-binary-file'];
  const contents = bytes.toString('utf8');
  const findings = contentRules
    .filter(([, pattern]) => pattern.test(contents))
    .map(([rule]) => rule);
  for (const match of contents.matchAll(credentialAssignment)) {
    if (!placeholder.test(match[1])) {
      findings.push('hardcoded-credential-assignment');
      break;
    }
  }
  return findings;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'buffer',
    maxBuffer: MAX_FILE_BYTES + 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  });
}

export function inspectIndex() {
  // Do not discover/read authentication files, recurse through ignored local
  // folders, or follow symbolic links. Git supplies only indexed blob objects.
  const root = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const indexed = git(['ls-files', '--stage', '-z'], { cwd: root }).toString('utf8');
  const entries = indexed.split('\0').filter(Boolean);
  if (!entries.length)
    return {
      files: 0,
      bytes: 0,
      findings: [{ file: '(index)', rule: 'empty-index-stage-publish-files-first' }],
    };
  const findings = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const parsed = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/.exec(entry);
    if (!parsed) {
      findings.push({ file: '(index)', rule: 'unreadable-index-entry' });
      continue;
    }
    const [, mode, objectId, stage, file] = parsed;
    const pathFindings = inspectPath(file, mode);
    if (stage !== '0') pathFindings.push('unresolved-merge-entry');
    findings.push(...pathFindings.map((rule) => ({ file, rule })));
    // Even staged credentials are rejected by filename without reading their
    // contents. Non-regular entries are not opened or dereferenced.
    if (pathFindings.length) continue;
    const size = Number(git(['cat-file', '-s', objectId], { cwd: root }).toString('utf8').trim());
    if (!Number.isSafeInteger(size) || size < 0) {
      findings.push({ file, rule: 'invalid-blob-size' });
      continue;
    }
    totalBytes += size;
    if (size > MAX_FILE_BYTES) {
      findings.push({ file, rule: 'file-exceeds-25-MiB' });
      continue;
    }
    const bytes = git(['cat-file', 'blob', objectId], { cwd: root });
    findings.push(...inspectContent(file, bytes).map((rule) => ({ file, rule })));
  }
  if (totalBytes > MAX_TOTAL_BYTES)
    findings.push({ file: '(index)', rule: 'total-exceeds-100-MiB' });
  return { files: entries.length, bytes: totalBytes, findings };
}

export function main() {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/check-public-release.mjs');
    process.exitCode = 2;
    return;
  }
  try {
    const result = inspectIndex();
    if (result.findings.length) {
      console.error('Public release check failed. Findings contain filenames and rule names only:');
      for (const { file, rule } of result.findings)
        console.error(`${JSON.stringify(file)}: ${rule}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Public release check passed: ${result.files} indexed files, ${(result.bytes / 1024 / 1024).toFixed(1)} MiB.`,
      );
      console.log(
        'Scope: staged/index content only; not Git history, untracked files, binary metadata, or a security guarantee.',
      );
    }
  } catch {
    // Git errors can contain local paths or content. Never echo the raw error.
    console.error(
      'Public release check could not inspect the Git index. Initialize the repository, stage the intended public files, and retry.',
    );
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
