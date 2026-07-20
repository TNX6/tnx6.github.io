import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const overlayMarkup = readFileSync(`${projectRoot}src/pages/overlays/dungeon.astro`, 'utf8');
const overlayCss = readFileSync(`${projectRoot}src/assets/styles/dungeon-overlay.css`, 'utf8');
const clientSource = readFileSync(`${projectRoot}src/scripts/dungeon-overlay-client.ts`, 'utf8');

test('anchors player identity to the figure instead of the slot', () => {
  assert.match(
    overlayMarkup,
    /dov-player-figure[\s\S]*dov-slot__identity-anchor[\s\S]*dov-slot__identity[\s\S]*dov-avatar/
  );
  assert.match(overlayCss, /\.dov-player-figure\s*{[\s\S]*?position:\s*relative;/);
  assert.match(
    overlayCss,
    /\.dov-slot__identity-anchor\s*{[\s\S]*?position:\s*absolute;[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);/
  );
});

test('keeps vertical identity motion separate from horizontal anchoring', () => {
  assert.match(
    overlayCss,
    /data-animation-state='dead'\] \.dov-slot__identity\s*{[\s\S]*?transform:\s*translateY\(var\(--dov-death-meta-drop/
  );
  assert.match(
    overlayCss,
    /data-animation-state='ghost'\] \.dov-slot__identity\s*{[\s\S]*?transform:\s*translateY\(calc\(var\(--dov-ghost-meta-offset/
  );
});

test('registers the isolated meta anchor regression demo', () => {
  assert.match(clientSource, /\| 'meta-anchor-regression';/);
  assert.match(clientSource, /function runMetaAnchorRegressionDemo\(\): void/);
  assert.match(clientSource, /'meta-anchor-regression': runMetaAnchorRegressionDemo/);
});
