import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import {
  DUNGEON_EQUIPMENT_PRODUCTION_AGGREGATE_SHA256,
  DUNGEON_EQUIPMENT_PRODUCTION_ASSET_DIRECTORY,
  DUNGEON_EQUIPMENT_PRODUCTION_FILE_COUNT,
  DUNGEON_EQUIPMENT_PRODUCTION_TOTAL_BYTES,
  validateDungeonEquipmentProductionAssets,
  validateDungeonEquipmentProductionManifest,
  validateDungeonEquipmentProductionSheet,
  validateDungeonEquipmentProductionTree,
} from '../scripts/dungeon-equipment-production-asset-validator.mjs';
import { DUNGEON_EQUIPMENT_ASSET_MANIFEST } from '../src/scripts/dungeon-equipment-assets.ts';

sharp.cache(false);

const projectRoot = path.resolve(import.meta.dirname, '..');
const productionAssets = path.join(projectRoot, DUNGEON_EQUIPMENT_PRODUCTION_ASSET_DIRECTORY);
const cleanup = (directory) => rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 80 });

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tnx6-equipment-production-validator-'));
  const assetRoot = path.join(directory, 'equipment-v2');
  await cp(productionAssets, assetRoot, { recursive: true });
  context.after(() => cleanup(directory));
  return assetRoot;
}

async function writeSheet(filePath, width, height, options = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const opaque = options.opaque ?? false;
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: opaque ? { r: 45, g: 33, b: 20, alpha: 1 } : { r: 45, g: 33, b: 20, alpha: 0 },
    },
  });
  if (!opaque) {
    pipeline.composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="${height}"><rect x="8" y="8" width="24" height="24" fill="#fff"/></svg>`
        ),
      },
    ]);
  }
  await (options.format === 'png' ? pipeline.png() : pipeline.webp({ lossless: true })).toFile(filePath);
}

function codes(errors) {
  return new Set(errors.map((error) => error.code));
}

test('production package succeeds with the locked release contract', async () => {
  const result = await validateDungeonEquipmentProductionAssets({ strictRelease: true });
  assert.deepEqual(result.errors, []);
  assert.equal(result.fileCount, DUNGEON_EQUIPMENT_PRODUCTION_FILE_COUNT);
  assert.equal(result.totalBytes, DUNGEON_EQUIPMENT_PRODUCTION_TOTAL_BYTES);
  assert.equal(result.aggregateSha256, DUNGEON_EQUIPMENT_PRODUCTION_AGGREGATE_SHA256);
});

test('a production tree with a file count other than 57 fails', async (context) => {
  const assetRoot = await fixture(context);
  await cp(path.join(assetRoot, 'base/red/idle.webp'), path.join(assetRoot, 'base/red/extra.webp'));
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('file_count'));
});

test('a missing base sheet fails', async (context) => {
  const assetRoot = await fixture(context);
  await unlink(path.join(assetRoot, 'base/red/death.webp'));
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('missing_file'));
});

test('a missing equipment sheet fails', async (context) => {
  const assetRoot = await fixture(context);
  await unlink(path.join(assetRoot, 'items/rusty-sword/idle-front.webp'));
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('missing_file'));
});

test('an extra undocumented asset fails', async (context) => {
  const assetRoot = await fixture(context);
  await cp(path.join(assetRoot, 'base/red/idle.webp'), path.join(assetRoot, 'items/steel-sword/extra.webp'));
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('undocumented_file'));
});

test('PNG in place of a WebP fails', async (context) => {
  const assetRoot = await fixture(context);
  const webp = path.join(assetRoot, 'base/red/idle.webp');
  const png = path.join(assetRoot, 'base/red/idle.png');
  await unlink(webp);
  await writeSheet(png, 512, 128, { format: 'png' });
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('format'));
});

test('wrong dimensions fail', async (context) => {
  const assetRoot = await fixture(context);
  const filePath = path.join(assetRoot, 'items/leather-cap/idle-main.webp');
  await writeSheet(filePath, 384, 120);
  assert.ok(
    codes(await validateDungeonEquipmentProductionSheet(filePath, { width: 512, height: 128, frames: 4 })).has(
      'dimensions'
    )
  );
});

test('wrong frame count fails', async (context) => {
  const assetRoot = await fixture(context);
  const filePath = path.join(assetRoot, 'items/leather-cap/idle-main.webp');
  await writeSheet(filePath, 384, 128);
  assert.ok(
    codes(await validateDungeonEquipmentProductionSheet(filePath, { width: 512, height: 128, frames: 4 })).has(
      'frame_count'
    )
  );
});

test('equipment without genuine alpha fails', async (context) => {
  const assetRoot = await fixture(context);
  const filePath = path.join(assetRoot, 'items/leather-cap/idle-main.webp');
  await writeSheet(filePath, 512, 128, { opaque: true });
  assert.ok(
    codes(await validateDungeonEquipmentProductionSheet(filePath, { width: 512, height: 128, frames: 4 })).has('alpha')
  );
});

test('equipment death and ghost states fail', async (context) => {
  const assetRoot = await fixture(context);
  await cp(
    path.join(assetRoot, 'items/leather-cap/idle-main.webp'),
    path.join(assetRoot, 'items/leather-cap/death-main.webp')
  );
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('unsupported_equipment_state'));
});

test('an unknown base palette fails', async (context) => {
  const assetRoot = await fixture(context);
  const unknown = path.join(assetRoot, 'base/cyan/idle.webp');
  await mkdir(path.dirname(unknown), { recursive: true });
  await cp(path.join(assetRoot, 'base/red/idle.webp'), unknown);
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('unknown_palette'));
});

test('an unknown item folder fails', async (context) => {
  const assetRoot = await fixture(context);
  const unknown = path.join(assetRoot, 'items/unknown-relic/idle-main.webp');
  await mkdir(path.dirname(unknown), { recursive: true });
  await cp(path.join(assetRoot, 'items/leather-cap/idle-main.webp'), unknown);
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('unknown_item'));
});

test('Rusty Sword back layer fails', async (context) => {
  const assetRoot = await fixture(context);
  await cp(
    path.join(assetRoot, 'items/rusty-sword/idle-front.webp'),
    path.join(assetRoot, 'items/rusty-sword/idle-back.webp')
  );
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('invalid_rusty_layer'));
});

test('Steel Sword with a missing front or back layer fails', async (context) => {
  const assetRoot = await fixture(context);
  await unlink(path.join(assetRoot, 'items/steel-sword/walk-front-back.webp'));
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('missing_file'));
});

test('main-layer equipment with a front or back file fails', async (context) => {
  const assetRoot = await fixture(context);
  await cp(
    path.join(assetRoot, 'items/iron-armor/idle-main.webp'),
    path.join(assetRoot, 'items/iron-armor/idle-front.webp')
  );
  assert.ok(codes(await validateDungeonEquipmentProductionTree(assetRoot)).has('invalid_main_item_layer'));
});

test('manifest path mismatch fails without reading an untrusted URL', () => {
  const equipmentManifest = structuredClone(DUNGEON_EQUIPMENT_ASSET_MANIFEST);
  equipmentManifest[0].paths.idle.front = '/assets/dungeon-overlay/equipment-v2/items/not-rusty/idle-front.webp';
  assert.ok(codes(validateDungeonEquipmentProductionManifest({ equipmentManifest })).has('manifest_path_mismatch'));
});

test('strict release mode rejects an aggregate hash mismatch', async (context) => {
  const assetRoot = await fixture(context);
  await cp(path.join(assetRoot, 'base/purple/idle.webp'), path.join(assetRoot, 'base/red/idle.webp'));
  assert.ok(
    codes(await validateDungeonEquipmentProductionTree(assetRoot, { strictRelease: true })).has('aggregate_hash')
  );
});
