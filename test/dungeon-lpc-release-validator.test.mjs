import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  calculateDungeonLpcReleaseAggregate,
  validateDungeonLpcReleasePackage,
} from '../scripts/dungeon-lpc-release-validator.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');

test('release scope covers the renderer, entry point, LPC runtime, base, generated assets, and attribution', async () => {
  const scope = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(path.join(projectRoot, 'scripts/dungeon-lpc-release-scope.json'), 'utf8')
  );
  const requiredFiles = [
    'src/scripts/dungeon-renderer-mode.ts',
    'src/scripts/dungeon-lpc-renderer.ts',
    'src/scripts/dungeon-lpc-overlay-integration.ts',
    'src/scripts/dungeon-lpc-generated-runtime-loader.ts',
    'src/pages/overlays/dungeon.astro',
    'src/scripts/dungeon-overlay-client.ts',
    'src/styles/dungeon-lpc-overlay-integration.css',
    'src/pages/credits.astro',
    'src/components/widgets/Footer.astro',
    'public/assets/dungeon-overlay/lpc-v1/CREDITS.txt',
    'scripts/dungeon-lpc-credits-generator.mjs',
    'scripts/dungeon-lpc-release-validator.mjs',
  ];
  requiredFiles.forEach((file) => assert.ok(scope.files.includes(file), file));
  [
    'public/assets/dungeon-overlay/lpc-v1/base',
    'public/assets/dungeon-overlay/lpc-v1/generated',
    'public/assets/dungeon-overlay/lpc-v1/runtime',
  ].forEach((tree) => assert.ok(scope.trees.includes(tree), tree));
});

test('current LPC candidate aggregate is deterministic and validates only against an exact approval', async () => {
  const first = await calculateDungeonLpcReleaseAggregate();
  const second = await calculateDungeonLpcReleaseAggregate();
  assert.deepEqual(second, first);
  assert.ok(first.fileCount > 4_900);
  assert.ok(first.totalBytes > 1_000_000);
  assert.match(first.aggregateSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    (await validateDungeonLpcReleasePackage({ expectedAggregateSha256: first.aggregateSha256 })).errors,
    []
  );
  assert.deepEqual(
    (await validateDungeonLpcReleasePackage({ expectedAggregateSha256: '0'.repeat(64) })).errors.map(
      (error) => error.code
    ),
    ['aggregate_hash']
  );
  assert.deepEqual(
    (await validateDungeonLpcReleasePackage()).errors.map((error) => error.code),
    ['missing_approval']
  );
});

test('scoped tree additions, byte changes, and missing files all fail closed', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tnx6-lpc-release-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'assets'), { recursive: true });
  await writeFile(path.join(directory, 'selector.ts'), 'lpc\n');
  await writeFile(path.join(directory, 'assets', 'base.png'), 'base\n');
  const scope = { version: 'fixture-v1', files: ['selector.ts'], trees: ['assets'] };
  const approved = await calculateDungeonLpcReleaseAggregate({ projectRoot: directory, scope });

  await writeFile(path.join(directory, 'selector.ts'), 'equipment-v2\n');
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope,
        expectedAggregateSha256: approved.aggregateSha256,
      })
    ).errors.map((error) => error.code),
    ['aggregate_hash']
  );

  await writeFile(path.join(directory, 'selector.ts'), 'lpc\n');
  await writeFile(path.join(directory, 'assets', 'unexpected.png'), 'unexpected\n');
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope,
        expectedAggregateSha256: approved.aggregateSha256,
      })
    ).errors.map((error) => error.code),
    ['aggregate_hash']
  );

  await rm(path.join(directory, 'selector.ts'));
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope,
        expectedAggregateSha256: approved.aggregateSha256,
      })
    ).errors.map((error) => error.code),
    ['invalid_scope']
  );
});

test('the first-paint integration stylesheet is byte-bound and required', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tnx6-lpc-release-css-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stylesheet = path.join(directory, 'dungeon-lpc-overlay-integration.css');
  const scope = {
    version: 'fixture-css-v1',
    files: ['dungeon-lpc-overlay-integration.css'],
    trees: [],
  };
  await writeFile(stylesheet, '[data-dungeon-renderer="lpc"] .legacy { visibility: hidden; }\n');
  const approved = await calculateDungeonLpcReleaseAggregate({ projectRoot: directory, scope });

  await writeFile(stylesheet, '[data-dungeon-renderer="lpc"] .legacy { visibility: visible; }\n');
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope,
        expectedAggregateSha256: approved.aggregateSha256,
      })
    ).errors.map((error) => error.code),
    ['aggregate_hash']
  );

  await rm(stylesheet);
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope,
        expectedAggregateSha256: approved.aggregateSha256,
      })
    ).errors.map((error) => error.code),
    ['invalid_scope']
  );
});

test('release scope rejects path escapes and symlinked tree entries', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tnx6-lpc-release-boundary-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'tnx6-lpc-release-outside-'));
  context.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'outside.css'), '.legacy { visibility: visible; }\n');

  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope: { version: 'fixture-escape-v1', files: ['../outside.css'], trees: [] },
        expectedAggregateSha256: '0'.repeat(64),
      })
    ).errors.map((error) => error.code),
    ['invalid_scope']
  );

  const assets = path.join(directory, 'assets');
  await mkdir(assets);
  await symlink(outside, path.join(assets, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(
    (
      await validateDungeonLpcReleasePackage({
        projectRoot: directory,
        scope: { version: 'fixture-symlink-v1', files: [], trees: ['assets'] },
        expectedAggregateSha256: '0'.repeat(64),
      })
    ).errors.map((error) => error.code),
    ['invalid_scope']
  );
});
