import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { inspectContent, inspectPath, MAX_FILE_BYTES } from './check-public-release.mjs';

const scan = (value) => inspectContent('src/example.ts', Buffer.from(value));

test('rejects private/generated filenames without needing their contents', () => {
  for (const path of [
    '.env',
    '.envrc',
    '.env.production',
    'nested/.env.local',
    '.vercel/project.json',
    'data/raw/source.feather',
    'data/.venv/bin/activate',
    'node_modules/package/index.js',
    '.npmrc',
    '.ssh/id_ed25519',
    '.openai/hosting.json',
    '.local/state.json',
    'credentials.json',
    'secrets.json',
    'artifacts/browser/run.png',
    'backup.zip',
  ]) {
    assert.ok(inspectPath(path).length, path);
  }
});

test('rejects symlinks, submodules and traversal', () => {
  assert.ok(inspectPath('src/linked.ts', '120000').length);
  assert.ok(inspectPath('vendor/library', '160000').length);
  assert.ok(inspectPath('../outside.ts').length);
  assert.ok(inspectPath('bad\nname.ts').length);
});

test('permits public scientific data, workflows and ordinary scripts', () => {
  for (const path of [
    'public/data/circuit-expanded.json',
    '.github/workflows/ci.yml',
    'scripts/check-public-release.mjs',
    'SECURITY.md',
  ])
    assert.deepEqual(inspectPath(path), []);
  assert.deepEqual(
    scan(JSON.stringify({ id: '720575940600000000', contacts: 123456, sha256: 'a'.repeat(64) })),
    [],
  );
});

test('finds provider tokens without storing a complete fixture token in source', () => {
  const samples = [
    [['gh', 'p_', 'A'.repeat(36)].join(''), 'github-token'],
    [['github', '_pat_', 'A'.repeat(40)].join(''), 'github-token'],
    [['AK', 'IA', 'A'.repeat(16)].join(''), 'aws-access-key'],
    [['AI', 'za', 'a'.repeat(35)].join(''), 'google-api-key'],
    [['sk', '-proj-', 'a'.repeat(32)].join(''), 'service-api-key'],
    [['xox', 'b-', 'a'.repeat(24)].join(''), 'slack-token'],
    [['sk', '_live_', 'a'.repeat(24)].join(''), 'stripe-live-key'],
    [['npm', '_', 'a'.repeat(36)].join(''), 'npm-token'],
  ];
  for (const [value, rule] of samples) assert.ok(scan(value).includes(rule), rule);
});

test('finds private key material and credential assignments', () => {
  assert.ok(
    scan(['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')).includes('private-key-material'),
  );
  assert.ok(
    scan(['api', '_key = ', JSON.stringify('not-a-real-credential')].join('')).includes(
      'hardcoded-credential-assignment',
    ),
  );
  assert.ok(
    scan(['password', ': ', JSON.stringify('abcdefghijk')].join('')).includes(
      'hardcoded-credential-assignment',
    ),
  );
  assert.ok(
    scan(['VITE_API', '_KEY = ', JSON.stringify('abcdefghijk')].join('')).includes(
      'hardcoded-credential-assignment',
    ),
  );
  assert.deepEqual(scan(['api', '_key = ', JSON.stringify('YOUR_API_KEY')].join('')), []);
  assert.deepEqual(scan('const value = process.env.API_KEY;'), []);
});

test('finds URL credentials, deployment identifiers and workstation paths', () => {
  assert.ok(
    scan(['https://', 'user:password', '@example.invalid'].join('')).includes('credential-in-url'),
  );
  assert.ok(scan(['dpl', '_', 'A'.repeat(24)].join('')).includes('deployment-identifier'));
  assert.ok(
    scan(['', 'Users', 'example-user', 'project'].join('/')).includes('workstation-home-path'),
  );
});

test('enforces file size and restricts binary files', () => {
  assert.deepEqual(inspectContent('large.json', Buffer.alloc(MAX_FILE_BYTES + 1)), [
    'file-exceeds-25-MiB',
  ]);
  assert.deepEqual(inspectContent('unknown.bin', Buffer.from([0, 1, 2])), [
    'unreviewed-binary-file',
  ]);
  assert.deepEqual(inspectContent('public/image.png', Buffer.from([0, 1, 2])), []);
});

test('scanner and tests do not flag their own rule definitions or synthetic fixtures', () => {
  for (const name of ['check-public-release.mjs', 'check-public-release.test.mjs']) {
    assert.deepEqual(
      inspectContent(`scripts/${name}`, readFileSync(new URL(name, import.meta.url))),
      [],
      name,
    );
  }
});
