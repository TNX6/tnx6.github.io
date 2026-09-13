import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { validateApprovedDungeonLpcRelease } from '../scripts/dungeon-lpc-release-approval-validator.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const approvedHash = '24e7d0d03a79e74fc037a4e8b9f4869d7f15f647e82fcd28f6a1abdd05e8db41';

test('source-controlled approval binds the exact LPC package without entering its self-hashed scope', async () => {
  const approval = JSON.parse(
    await readFile(path.join(projectRoot, 'scripts/dungeon-lpc-release-approval.json'), 'utf8')
  );
  const scope = JSON.parse(await readFile(path.join(projectRoot, approval.scopeManifest), 'utf8'));

  assert.equal(approval.aggregateSha256, approvedHash);
  assert.equal(approval.version, scope.version);
  assert.equal(scope.files.includes('scripts/dungeon-lpc-release-approval.json'), false);
  assert.equal(scope.files.includes('scripts/dungeon-lpc-release-approval-validator.mjs'), false);

  const result = await validateApprovedDungeonLpcRelease({ projectRoot });
  assert.deepEqual(result.errors, []);
  assert.equal(result.aggregate.aggregateSha256, approvedHash);
  assert.equal(result.aggregate.fileCount, approval.fileCount);
  assert.equal(result.aggregate.totalBytes, approval.totalBytes);
});

test('approval validation fails closed for a different hash or package metadata', async () => {
  const base = {
    version: 'dungeon-lpc-release-v1',
    scopeManifest: 'scripts/dungeon-lpc-release-scope.json',
    fileCount: 4977,
    totalBytes: 15867068,
    aggregateSha256: approvedHash,
  };

  const wrongHash = await validateApprovedDungeonLpcRelease({
    projectRoot,
    approval: { ...base, aggregateSha256: '0'.repeat(64) },
  });
  assert.deepEqual(
    wrongHash.errors.map((error) => error.code),
    ['aggregate_hash']
  );

  const wrongMetadata = await validateApprovedDungeonLpcRelease({
    projectRoot,
    approval: { ...base, fileCount: base.fileCount + 1 },
  });
  assert.deepEqual(
    wrongMetadata.errors.map((error) => error.code),
    ['approval_file_count']
  );

  const invalidApproval = await validateApprovedDungeonLpcRelease({
    projectRoot,
    approval: { ...base, scopeManifest: 'scripts/other-scope.json' },
  });
  assert.deepEqual(
    invalidApproval.errors.map((error) => error.code),
    ['invalid_approval']
  );
});
