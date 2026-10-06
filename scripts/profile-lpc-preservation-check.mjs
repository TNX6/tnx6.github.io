// This reader-only release preserves the already-deployed Git LPC package.
// The older approval hashes a Windows mixed-EOL checkout, not Git blob bytes.
// Do not replace that approval or normalize/rewrite any source or asset here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, input) => execFileSync('git', ['-C', root, ...args], {
  input, maxBuffer: 128 * 1024 * 1024, windowsHide: true,
});
const scope = JSON.parse(readFileSync(new URL('./dungeon-lpc-release-scope.json', import.meta.url)));
const expected = 'd7b5e162564a07a806c530968ad122ebad2f0c7ce72881032c5133eaf9a1eb04';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = git(['ls-tree', '-r', '-z', 'HEAD']).toString().split('\0').filter(Boolean).map(line => {
  const i = line.indexOf('\t'); return { path: line.slice(i + 1), oid: line.slice(0, i).split(' ')[2] };
}).filter(row => scope.files.includes(row.path) || scope.trees.some(tree => row.path.startsWith(tree + '/')))
  .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const diskPaths = [...scope.files];
function walk(dir) {
  for (const entry of readdirSync(root + dir, { withFileTypes: true })) {
    const relative = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(relative);
    else { assert.ok(entry.isFile(), 'No unsupported scope entry'); diskPaths.push(relative); }
  }
}
scope.trees.forEach(walk);
assert.deepEqual(diskPaths.sort(), rows.map(row => row.path), 'Scope must contain exactly the deployed paths');
const batch = git(['cat-file', '--batch'], rows.map(row => row.oid).join('\n') + '\n');
let offset = 0;
const records = [];
for (const row of rows) {
  const end = batch.indexOf(10, offset);
  const size = Number(batch.subarray(offset, end).toString().split(' ')[2]);
  offset = end + 1;
  const bytes = batch.subarray(offset, offset + size); offset += size + 1;
  const local = readFileSync(root + row.path);
  // Git checkout line-ending conversion is the only tolerated byte difference.
  assert.ok(local.equals(bytes) || (!local.includes(0) && Buffer.from(local.toString('utf8').replaceAll('\r\n', '\n')).equals(bytes)),
    'Working LPC file differs from its Git blob: ' + row.path);
  records.push(`${row.path}\t${bytes.length}\t${sha(bytes)}`);
}
assert.equal(rows.length, 4978);
assert.equal(sha(Buffer.from(scope.version + '\n' + records.join('\n') + '\n')), expected,
  'LPC Git package changed from deployed baseline 01781b137e02a1d062bb0f341df027aac2021ea8');
console.log('Deployed LPC Git package preserved: 4978 files; approved checkout differs only by EOL.');
