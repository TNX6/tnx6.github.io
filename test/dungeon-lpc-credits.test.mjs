import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateDungeonLpcCredits } from '../scripts/dungeon-lpc-credits-generator.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const lpcRoot = path.join(projectRoot, 'public/assets/dungeon-overlay/lpc-v1');

test('credits route distinguishes TNX6 code from LPC art and exposes exact source-backed references', async () => {
  const page = await readFile(path.join(projectRoot, 'src/pages/credits.astro'), 'utf8');
  assert.match(page, /TNX6 application and code/);
  assert.match(page, /Universal LPC \/ Dungeon Character Assets/);
  assert.match(page, /bluecarrot16/);
  assert.match(page, /Stephen Challener \(Redshrike\)/);
  assert.match(page, /OGA-BY 3\.0/);
  assert.match(page, /CC-BY-SA 3\.0/);
  assert.match(page, /GPL 3\.0/);
  assert.match(page, /\/assets\/dungeon-overlay\/lpc-v1\/CREDITS\.txt/);
  assert.match(page, /generated-equipment-catalog\.json/);
  assert.match(page, /https:\/\/opengameart\.org\/content\/lpc-expanded-expressions/);
  assert.doesNotMatch(page, /opengameart\.org\/content\/ulpc-expanded-expressions/);
  assert.doesNotMatch(page, /TNX6 (?:created|owns) (?:Universal )?LPC/i);
});

test('normal application footer exposes a visible, naturally labeled credits link', async () => {
  const footer = await readFile(path.join(projectRoot, 'src/components/widgets/Footer.astro'), 'utf8');
  assert.match(footer, /getPermalink\('\/credits'\)/);
  assert.match(footer, /Asset Credits/);
  assert.doesNotMatch(footer, /(?:hidden|sr-only|display:\s*none|visibility:\s*hidden)/i);
});

test('full LPC credits artifact is deterministic and covers base plus all direct and generated credit files', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tnx6-lpc-credits-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const firstPath = path.join(directory, 'first.txt');
  const secondPath = path.join(directory, 'second.txt');
  const first = await generateDungeonLpcCredits({ lpcRoot, outputPath: firstPath });
  const second = await generateDungeonLpcCredits({ lpcRoot, outputPath: secondPath });
  assert.equal(first.files.length, 697);
  assert.deepEqual(second.files, first.files);
  assert.equal(second.output, first.output);
  assert.match(first.output, /SOURCE CREDIT FILE: credits\/credits\.txt/);
  assert.match(first.output, /SOURCE CREDIT FILE: equipment\/test-armor\/credits\.txt/);
  assert.match(first.output, /SOURCE CREDIT FILE: generated\/lpc-visual-/);
  assert.match(first.output, /bluecarrot16/);
  assert.match(first.output, /Sander Frenken \(castelonia\)/);
  assert.match(first.output, /https:\/\/opengameart\.org\//);
});
