import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonSpriteAssetLoader, preloadPrimaryCharacterAssets } from '../src/scripts/dungeon-overlay-assets.ts';

function decodedImageFactory(results) {
  let created = 0;
  return {
    count: () => created,
    factory: () => {
      const result = results[created] ?? true;
      created += 1;
      return {
        src: '',
        onload: null,
        onerror: null,
        decode: () => (result ? Promise.resolve() : Promise.reject(new Error('decode failed'))),
      };
    },
  };
}

test('caches each sprite URL and decodes it only once', async () => {
  const images = decodedImageFactory([true]);
  const loader = new DungeonSpriteAssetLoader(images.factory, 100);
  const [first, second] = await Promise.all([loader.load('/idle.webp'), loader.load('/idle.webp')]);
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(images.count(), 1);
});

test('uses fallback mode when either primary sprite decode fails', async () => {
  const images = decodedImageFactory([true, false]);
  const loader = new DungeonSpriteAssetLoader(images.factory, 100);
  const mode = await preloadPrimaryCharacterAssets(loader, {
    idleSheet: '/idle.webp',
    walkFrontSheet: '/walk-front.webp',
  });
  assert.equal(mode, 'fallback');
});

test('keeps independent character loads isolated when one decode fails', async () => {
  const images = decodedImageFactory([false, true]);
  const loader = new DungeonSpriteAssetLoader(images.factory, 100);
  assert.deepEqual(await Promise.all([loader.load('/red.webp'), loader.load('/blue.webp')]), [false, true]);
});

test('does not resolve actor readiness before both primary decodes complete', async () => {
  const resolvers = [];
  const loader = new DungeonSpriteAssetLoader(
    () => ({
      src: '',
      onload: null,
      onerror: null,
      decode: () => new Promise((resolve) => resolvers.push(resolve)),
    }),
    100
  );
  let ready = false;
  const request = preloadPrimaryCharacterAssets(loader, {
    idleSheet: '/idle.webp',
    walkFrontSheet: '/walk-front.webp',
  }).then((mode) => {
    ready = true;
    return mode;
  });

  await Promise.resolve();
  assert.equal(ready, false);
  resolvers.splice(0).forEach((resolve) => resolve());
  assert.equal(await request, 'animated');
  assert.equal(ready, true);
});
