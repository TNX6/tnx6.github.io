import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import sharp from 'sharp';

import {
  CHARACTER_ANIMATION_CONFIG,
  DUNGEON_CHARACTER_STYLES,
} from '../src/scripts/dungeon-overlay-character-config.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const expectedSheets = {
  idleSheet: { frames: 4, width: 512 },
  walkFrontSheet: { frames: 6, width: 768 },
  walkBackSheet: { frames: 6, width: 768 },
  deathSheet: { frames: 5, width: 640 },
  ghostSheet: { frames: 4, width: 512 },
};

test('configures all six character styles with isolated animation sheets', async () => {
  assert.deepEqual(DUNGEON_CHARACTER_STYLES, ['red', 'purple', 'green', 'orange', 'blue', 'black-gold']);

  for (const style of DUNGEON_CHARACTER_STYLES) {
    const config = CHARACTER_ANIMATION_CONFIG[style];
    assert.ok(config);
    assert.deepEqual(config.frameCounts, {
      idle: 4,
      walkFront: 6,
      walkBack: 6,
      death: 5,
      ghost: 4,
    });

    for (const [property, expected] of Object.entries(expectedSheets)) {
      const publicPath = config[property];
      assert.match(publicPath, new RegExp(`/animated/${style}/character-${style}-`));
      assert.doesNotMatch(publicPath, /\/characters\/character-[^/]+-sheet\.webp$/);

      const diskPath = `${projectRoot}public${publicPath}`;
      assert.equal(existsSync(diskPath), true, `${style} ${property} is missing`);
      const metadata = await sharp(diskPath).metadata();
      assert.deepEqual(
        { format: metadata.format, width: metadata.width, height: metadata.height },
        { format: 'webp', width: expected.width, height: 128 }
      );
      assert.equal(config.frameCounts[property.replace('Sheet', '')], expected.frames);
    }
  }
});

test('keeps animation tuning within the approved ranges', () => {
  for (const style of DUNGEON_CHARACTER_STYLES) {
    const config = CHARACTER_ANIMATION_CONFIG[style];
    assert.ok(config.durations.idle >= 880 && config.durations.idle <= 1_100);
    assert.ok(config.durations.walk >= 520 && config.durations.walk <= 680);
    assert.ok(config.durations.death >= 450 && config.durations.death <= 600);
    assert.ok(config.durations.ghost >= 1_100 && config.durations.ghost <= 1_400);
    assert.equal(config.deathHoldMs, 300);
    assert.ok(config.deathMetaDrop > 0);
    assert.ok(config.ghostScale >= 0.85 && config.ghostScale <= 1);
    assert.equal(config.footAnchor, 120);
  }

  assert.ok(CHARACTER_ANIMATION_CONFIG.green.ghostScale < CHARACTER_ANIMATION_CONFIG.blue.ghostScale);
  assert.ok(CHARACTER_ANIMATION_CONFIG.green.ghostScale <= 0.89);
  assert.ok(CHARACTER_ANIMATION_CONFIG['black-gold'].ghostScale <= CHARACTER_ANIMATION_CONFIG.blue.ghostScale);
});
