import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const defaultScopePath = path.join(projectRoot, 'scripts/dungeon-lpc-release-scope.json');
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function issue(code, file, message) {
  return { code, file, message };
}

function normalizedRelative(value) {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`Invalid release scope path: ${value}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid release scope path: ${value}`);
  }
  return parts.join('/');
}

function resolvedInside(root, relative) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.split('/'));
  const prefix = `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new Error(`Release scope escapes project root: ${relative}`);
  }
  return resolved;
}

async function readScope(scopePath) {
  const parsed = JSON.parse(await readFile(scopePath, 'utf8'));
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.version !== 'string' ||
    !Array.isArray(parsed.files) ||
    !Array.isArray(parsed.trees)
  ) {
    throw new TypeError('Dungeon LPC release scope has an invalid shape.');
  }
  return {
    version: parsed.version,
    files: parsed.files.map(normalizedRelative),
    trees: parsed.trees.map(normalizedRelative),
  };
}

async function walkTree(root, relativeRoot) {
  const files = [];
  const visit = async (directory, relativeDirectory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath, relative);
      else if (entry.isFile()) files.push({ fullPath, relative });
      else throw new TypeError(`Unsupported release-scope entry: ${relative}`);
    }
  };
  const fullRoot = resolvedInside(root, relativeRoot);
  const rootStat = await stat(fullRoot);
  if (!rootStat.isDirectory()) throw new TypeError(`Release tree is not a directory: ${relativeRoot}`);
  await visit(fullRoot, relativeRoot);
  return files;
}

export async function calculateDungeonLpcReleaseAggregate(options = {}) {
  const root = options.projectRoot ?? projectRoot;
  const scopePath = options.scopePath ?? defaultScopePath;
  const scope = options.scope ?? (await readScope(scopePath));
  const files = [];

  for (const relative of scope.files.map(normalizedRelative)) {
    const fullPath = resolvedInside(root, relative);
    const fileStat = await stat(fullPath);
    if (!fileStat.isFile()) throw new TypeError(`Release file is not a regular file: ${relative}`);
    files.push({ fullPath, relative });
  }
  for (const relativeTree of scope.trees.map(normalizedRelative)) {
    files.push(...(await walkTree(root, relativeTree)));
  }

  const unique = new Map();
  for (const file of files) {
    if (unique.has(file.relative)) throw new TypeError(`Duplicate release-scope file: ${file.relative}`);
    unique.set(file.relative, file);
  }

  const records = [];
  let totalBytes = 0;
  for (const file of [...unique.values()].sort((left, right) => compareText(left.relative, right.relative))) {
    const bytes = await readFile(file.fullPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    totalBytes += bytes.length;
    records.push(`${file.relative}\t${bytes.length}\t${sha256}`);
  }
  const aggregateSha256 = createHash('sha256')
    .update(`${scope.version}\n${records.join('\n')}\n`, 'utf8')
    .digest('hex');
  return {
    version: scope.version,
    aggregateSha256,
    fileCount: records.length,
    totalBytes,
    files: records.map((record) => record.split('\t', 1)[0]),
  };
}

export async function validateDungeonLpcReleasePackage(options = {}) {
  const expectedAggregateSha256 = options.expectedAggregateSha256;
  if (!/^[a-f0-9]{64}$/.test(expectedAggregateSha256 ?? '')) {
    return {
      errors: [issue('missing_approval', 'dungeon-lpc-release-v1', 'An exact approved SHA-256 is required.')],
      aggregate: null,
    };
  }
  try {
    const aggregate = await calculateDungeonLpcReleaseAggregate(options);
    const errors =
      aggregate.aggregateSha256 === expectedAggregateSha256
        ? []
        : [
            issue(
              'aggregate_hash',
              aggregate.version,
              `Expected ${expectedAggregateSha256}, got ${aggregate.aggregateSha256}`
            ),
          ];
    return { errors, aggregate };
  } catch (error) {
    return {
      errors: [
        issue('invalid_scope', 'dungeon-lpc-release-v1', error instanceof Error ? error.message : String(error)),
      ],
      aggregate: null,
    };
  }
}

async function runCli() {
  const aggregate = await calculateDungeonLpcReleaseAggregate();
  console.log(
    `Dungeon LPC candidate ${aggregate.version}: ${aggregate.fileCount} files, ${aggregate.totalBytes} bytes, SHA-256 ${aggregate.aggregateSha256}.`
  );
  console.log('No production approval value was changed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
