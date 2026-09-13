import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDungeonLpcReleasePackage } from './dungeon-lpc-release-validator.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultApprovalPath = path.join(projectRoot, 'scripts/dungeon-lpc-release-approval.json');
const approvedScopeManifest = 'scripts/dungeon-lpc-release-scope.json';

function issue(code, message) {
  return { code, file: 'scripts/dungeon-lpc-release-approval.json', message };
}

function validateApproval(approval) {
  if (
    !approval ||
    typeof approval !== 'object' ||
    approval.version !== 'dungeon-lpc-release-v1' ||
    approval.scopeManifest !== approvedScopeManifest ||
    !Number.isSafeInteger(approval.fileCount) ||
    approval.fileCount <= 0 ||
    !Number.isSafeInteger(approval.totalBytes) ||
    approval.totalBytes <= 0 ||
    !/^[a-f0-9]{64}$/.test(approval.aggregateSha256 ?? '')
  ) {
    throw new TypeError('Dungeon LPC release approval has an invalid or unsupported shape.');
  }
  return approval;
}

async function readApproval(approvalPath) {
  return validateApproval(JSON.parse(await readFile(approvalPath, 'utf8')));
}

export async function validateApprovedDungeonLpcRelease(options = {}) {
  try {
    const root = options.projectRoot ?? projectRoot;
    const approval =
      options.approval === undefined
        ? await readApproval(options.approvalPath ?? defaultApprovalPath)
        : validateApproval(options.approval);
    const scopePath = options.scopePath ?? path.join(root, approvedScopeManifest);
    const result = await validateDungeonLpcReleasePackage({
      projectRoot: root,
      scopePath,
      expectedAggregateSha256: approval.aggregateSha256,
    });
    if (result.errors.length > 0 || !result.aggregate) return { ...result, approval };

    const errors = [];
    if (result.aggregate.version !== approval.version) {
      errors.push(issue('approval_version', `Expected ${approval.version}, got ${result.aggregate.version}.`));
    }
    if (result.aggregate.fileCount !== approval.fileCount) {
      errors.push(issue('approval_file_count', `Expected ${approval.fileCount}, got ${result.aggregate.fileCount}.`));
    }
    if (result.aggregate.totalBytes !== approval.totalBytes) {
      errors.push(
        issue('approval_total_bytes', `Expected ${approval.totalBytes}, got ${result.aggregate.totalBytes}.`)
      );
    }
    return { errors, aggregate: result.aggregate, approval };
  } catch (error) {
    return {
      errors: [issue('invalid_approval', error instanceof Error ? error.message : String(error))],
      aggregate: null,
      approval: null,
    };
  }
}

async function runCli() {
  const result = await validateApprovedDungeonLpcRelease();
  if (result.errors.length > 0 || !result.aggregate) {
    for (const error of result.errors) console.error(`[${error.code}] ${error.file}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Approved Dungeon LPC release ${result.aggregate.version}: ${result.aggregate.fileCount} files, ${result.aggregate.totalBytes} bytes, SHA-256 ${result.aggregate.aggregateSha256}.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
