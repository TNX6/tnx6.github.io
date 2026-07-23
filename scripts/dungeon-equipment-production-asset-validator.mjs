import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  DUNGEON_EQUIPMENT_BASE_PALETTES,
  DUNGEON_EQUIPMENT_BASE_STATES,
  DUNGEON_EQUIPMENT_SHEET_CONTRACT,
  DUNGEON_EQUIPMENT_WEARABLE_STATES,
} from '../src/scripts/dungeon-equipment-asset-contract.ts';
import {
  DUNGEON_EQUIPMENT_ASSET_MANIFEST,
  DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
  DUNGEON_EQUIPMENT_PRODUCTION_ROOT,
} from '../src/scripts/dungeon-equipment-assets.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export const DUNGEON_EQUIPMENT_PRODUCTION_ASSET_DIRECTORY = 'public/assets/dungeon-overlay/equipment-v2';
export const DUNGEON_EQUIPMENT_PRODUCTION_FILE_COUNT = 57;
export const DUNGEON_EQUIPMENT_PRODUCTION_TOTAL_BYTES = 404_468;
export const DUNGEON_EQUIPMENT_PRODUCTION_AGGREGATE_SHA256 =
  '49fc32b099a33a7e0dfb131ff781bce3ae41dca863b62b4bfe958b32754a05b8';

const EXPECTED_ITEMS = Object.freeze([
  {
    itemKey: 'dungeon.equipment.weapon.rusty_sword',
    spriteKey: 'rusty-sword',
    slot: 'weapon',
    rarity: 'common',
    layers: { back: false, main: false, front: true },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.weapon.steel_sword',
    spriteKey: 'steel-sword',
    slot: 'weapon',
    rarity: 'rare',
    layers: { back: true, main: false, front: true },
    linkedWeaponParts: true,
  },
  {
    itemKey: 'dungeon.equipment.helmet.leather_cap',
    spriteKey: 'leather-cap',
    slot: 'helmet',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.helmet.iron_helmet',
    spriteKey: 'iron-helmet',
    slot: 'helmet',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.armor.patched_leather',
    spriteKey: 'patched-leather',
    slot: 'armor',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.armor.iron_armor',
    spriteKey: 'iron-armor',
    slot: 'armor',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.boots.traveler_boots',
    spriteKey: 'traveler-boots',
    slot: 'boots',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
  {
    itemKey: 'dungeon.equipment.boots.guard_boots',
    spriteKey: 'guard-boots',
    slot: 'boots',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
    linkedWeaponParts: false,
  },
]);

const EXPECTED_ITEM_BY_SPRITE_KEY = new Map(EXPECTED_ITEMS.map((item) => [item.spriteKey, item]));
const EXPECTED_MAIN_ITEM_KEYS = new Set(
  EXPECTED_ITEMS.filter((item) => item.layers.main).map((item) => item.spriteKey)
);

function issue(code, file, message) {
  return { code, file, message };
}

function relativeUrlToAssetPath(url) {
  const prefix = `${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

function expectedParts(item) {
  return ['back', 'main', 'front'].filter((part) => item.layers[part]);
}

function canonicalExpectedFiles() {
  const files = new Map();
  for (const palette of DUNGEON_EQUIPMENT_BASE_PALETTES) {
    for (const state of DUNGEON_EQUIPMENT_BASE_STATES) {
      files.set(`base/${palette}/${state}.webp`, DUNGEON_EQUIPMENT_SHEET_CONTRACT[state]);
    }
  }
  for (const item of EXPECTED_ITEMS) {
    for (const state of DUNGEON_EQUIPMENT_WEARABLE_STATES) {
      for (const part of expectedParts(item)) {
        files.set(`items/${item.spriteKey}/${state}-${part}.webp`, DUNGEON_EQUIPMENT_SHEET_CONTRACT[state]);
      }
    }
  }
  return files;
}

export const DUNGEON_EQUIPMENT_PRODUCTION_EXPECTED_FILES = canonicalExpectedFiles();

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameLayers(left, right) {
  return ['back', 'main', 'front'].every((part) => left?.[part] === right[part]);
}

export function validateDungeonEquipmentProductionManifest(options = {}) {
  const baseManifest = options.baseManifest ?? DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST;
  const equipmentManifest = options.equipmentManifest ?? DUNGEON_EQUIPMENT_ASSET_MANIFEST;
  const errors = [];
  const baseKeys = Object.keys(baseManifest);

  if (!sameArray(baseKeys, [...DUNGEON_EQUIPMENT_BASE_PALETTES])) {
    errors.push(
      issue(
        'base_palette_contract',
        'src/scripts/dungeon-equipment-assets.ts',
        `Expected palettes ${DUNGEON_EQUIPMENT_BASE_PALETTES.join(', ')}, got ${baseKeys.join(', ')}`
      )
    );
  }

  for (const palette of DUNGEON_EQUIPMENT_BASE_PALETTES) {
    const base = baseManifest[palette];
    if (!base) {
      errors.push(issue('missing_palette', palette, 'Production base palette is missing'));
      continue;
    }
    if (base.palette !== palette || base.frameWidth !== 128 || base.frameHeight !== 128) {
      errors.push(issue('base_palette_contract', palette, 'Base palette metadata does not match the 128px contract'));
    }
    const stateKeys = Object.keys(base.paths ?? {});
    if (!sameArray(stateKeys, [...DUNGEON_EQUIPMENT_BASE_STATES])) {
      errors.push(issue('base_state_contract', palette, 'Base palette must expose exactly the five production states'));
    }
    for (const state of DUNGEON_EQUIPMENT_BASE_STATES) {
      const expectedPath = `${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/base/${palette}/${state}.webp`;
      if (base.paths?.[state] !== expectedPath) {
        errors.push(issue('base_path_mismatch', `${palette}:${state}`, `Expected ${expectedPath}`));
      }
    }
  }

  if (equipmentManifest.length !== EXPECTED_ITEMS.length) {
    errors.push(
      issue(
        'manifest_item_count',
        'src/scripts/dungeon-equipment-assets.ts',
        `Expected ${EXPECTED_ITEMS.length} equipment entries, got ${equipmentManifest.length}`
      )
    );
  }

  const actualBySprite = new Map();
  const itemKeys = new Set();
  for (const item of equipmentManifest) {
    if (actualBySprite.has(item.spriteKey)) {
      errors.push(issue('duplicate_sprite_key', item.spriteKey, 'Duplicate production spriteKey'));
    }
    if (itemKeys.has(item.itemKey)) {
      errors.push(issue('duplicate_item_key', item.itemKey, 'Duplicate production itemKey'));
    }
    actualBySprite.set(item.spriteKey, item);
    itemKeys.add(item.itemKey);
    if (!EXPECTED_ITEM_BY_SPRITE_KEY.has(item.spriteKey)) {
      errors.push(issue('unknown_manifest_item', item.spriteKey, 'Unknown production equipment item'));
    }
  }

  for (const expected of EXPECTED_ITEMS) {
    const actual = actualBySprite.get(expected.spriteKey);
    if (!actual) {
      errors.push(issue('missing_manifest_item', expected.spriteKey, 'Production equipment item is missing'));
      continue;
    }
    for (const field of ['itemKey', 'spriteKey', 'slot', 'rarity', 'linkedWeaponParts']) {
      if (actual[field] !== expected[field]) {
        errors.push(
          issue(
            'manifest_identity_mismatch',
            expected.spriteKey,
            `${field} expected ${String(expected[field])}, got ${String(actual[field])}`
          )
        );
      }
    }
    if (!sameLayers(actual.layers, expected.layers)) {
      errors.push(issue('manifest_layer_mismatch', expected.spriteKey, 'Layer kinds do not match production contract'));
    }
    if (!sameArray(actual.states ?? [], [...DUNGEON_EQUIPMENT_WEARABLE_STATES])) {
      errors.push(
        issue('manifest_state_mismatch', expected.spriteKey, 'States must be idle, walk-front, and walk-back')
      );
    }
    const parts = expectedParts(expected);
    for (const state of DUNGEON_EQUIPMENT_WEARABLE_STATES) {
      const statePaths = actual.paths?.[state] ?? {};
      const actualParts = Object.keys(statePaths).sort();
      if (!sameArray(actualParts, [...parts].sort())) {
        errors.push(
          issue(
            'manifest_layer_mismatch',
            `${expected.spriteKey}:${state}`,
            `Expected layers ${parts.join(', ') || '<none>'}`
          )
        );
      }
      for (const part of parts) {
        const expectedPath = `${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/items/${expected.spriteKey}/${state}-${part}.webp`;
        const actualPath = statePaths[part];
        if (actualPath !== expectedPath || relativeUrlToAssetPath(actualPath ?? '') === null) {
          errors.push(
            issue(
              'manifest_path_mismatch',
              `${expected.spriteKey}:${state}:${part}`,
              `Expected ${expectedPath}, got ${actualPath ?? '<missing>'}`
            )
          );
        }
      }
    }
  }

  return errors;
}

async function walkAssetTree(root) {
  const files = [];
  const directories = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(root, fullPath).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        directories.push(relative);
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push({ fullPath, relative });
      } else {
        files.push({ fullPath, relative, unsupported: true });
      }
    }
  }

  await visit(root);
  return { files, directories };
}

function expectedDirectories() {
  return new Set([
    'base',
    ...DUNGEON_EQUIPMENT_BASE_PALETTES.map((palette) => `base/${palette}`),
    'items',
    ...EXPECTED_ITEMS.map((item) => `items/${item.spriteKey}`),
  ]);
}

function classifyUnexpectedPath(relative) {
  const parts = relative.split('/');
  if (parts[0] === 'base' && parts[1] && !DUNGEON_EQUIPMENT_BASE_PALETTES.includes(parts[1])) {
    return issue('unknown_palette', relative, `Unknown base palette ${parts[1]}`);
  }
  if (parts[0] === 'items' && parts[1] && !EXPECTED_ITEM_BY_SPRITE_KEY.has(parts[1])) {
    return issue('unknown_item', relative, `Unknown equipment item folder ${parts[1]}`);
  }
  if (parts[0] === 'items' && /^(?:death|ghost)(?:-|\.|$)/.test(parts.at(-1) ?? '')) {
    return issue('unsupported_equipment_state', relative, 'Equipment death and ghost sheets are forbidden');
  }
  if (parts[0] === 'items' && parts[1] === 'rusty-sword' && /-back\.webp$/i.test(parts.at(-1) ?? '')) {
    return issue('invalid_rusty_layer', relative, 'Rusty Sword supports only the front layer');
  }
  if (
    parts[0] === 'items' &&
    EXPECTED_MAIN_ITEM_KEYS.has(parts[1]) &&
    /-(?:front|back)\.webp$/i.test(parts.at(-1) ?? '')
  ) {
    return issue('invalid_main_item_layer', relative, 'Defensive equipment supports only the main layer');
  }
  return issue('undocumented_file', relative, 'Asset is not documented by the production contract');
}

export async function calculateDungeonEquipmentAssetAggregate(assetRoot) {
  const { files } = await walkAssetTree(assetRoot);
  const records = [];
  let totalBytes = 0;

  for (const file of files) {
    const bytes = await readFile(file.fullPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    totalBytes += bytes.length;
    records.push(`${file.relative}\t${hash}`);
  }

  records.sort();
  const aggregateSha256 = createHash('sha256')
    .update(`${records.join('\n')}\n`, 'utf8')
    .digest('hex');
  return { aggregateSha256, fileCount: files.length, totalBytes };
}

export async function validateDungeonEquipmentProductionTree(assetRoot, options = {}) {
  const strictRelease = options.strictRelease ?? false;
  const errors = [];
  let tree;
  try {
    tree = await walkAssetTree(assetRoot);
  } catch (error) {
    return [
      issue(
        'missing_root',
        assetRoot,
        error instanceof Error ? error.message : 'Production equipment asset directory is missing'
      ),
    ];
  }

  const expectedFiles = new Set(DUNGEON_EQUIPMENT_PRODUCTION_EXPECTED_FILES.keys());
  const actualFiles = new Set(tree.files.map((file) => file.relative));
  const documentedDirectories = expectedDirectories();

  if (tree.files.length !== DUNGEON_EQUIPMENT_PRODUCTION_FILE_COUNT) {
    errors.push(
      issue(
        'file_count',
        assetRoot,
        `Expected ${DUNGEON_EQUIPMENT_PRODUCTION_FILE_COUNT} files, got ${tree.files.length}`
      )
    );
  }

  for (const expected of expectedFiles) {
    if (!actualFiles.has(expected))
      errors.push(issue('missing_file', expected, 'Required production asset is missing'));
  }

  for (const directory of tree.directories) {
    if (!documentedDirectories.has(directory)) {
      errors.push(issue('undocumented_directory', directory, 'Directory is not documented by the production contract'));
    }
  }

  for (const file of tree.files) {
    if (file.unsupported) {
      errors.push(issue('unsupported_entry', file.relative, 'Only regular files are permitted'));
      continue;
    }
    if (path.extname(file.relative).toLowerCase() !== '.webp') {
      errors.push(issue('format', file.relative, 'Only WebP files are permitted'));
    }
    if (!expectedFiles.has(file.relative)) errors.push(classifyUnexpectedPath(file.relative));
  }

  if (strictRelease) {
    const aggregate = await calculateDungeonEquipmentAssetAggregate(assetRoot);
    if (aggregate.totalBytes !== DUNGEON_EQUIPMENT_PRODUCTION_TOTAL_BYTES) {
      errors.push(
        issue(
          'total_size',
          assetRoot,
          `Expected ${DUNGEON_EQUIPMENT_PRODUCTION_TOTAL_BYTES} bytes, got ${aggregate.totalBytes}`
        )
      );
    }
    if (aggregate.aggregateSha256 !== DUNGEON_EQUIPMENT_PRODUCTION_AGGREGATE_SHA256) {
      errors.push(
        issue(
          'aggregate_hash',
          assetRoot,
          `Expected ${DUNGEON_EQUIPMENT_PRODUCTION_AGGREGATE_SHA256}, got ${aggregate.aggregateSha256}`
        )
      );
    }
  }

  return errors;
}

export async function validateDungeonEquipmentProductionSheet(filePath, expected) {
  const errors = [];
  let metadata;
  let bytes;
  try {
    [metadata, bytes] = await Promise.all([sharp(filePath).metadata(), readFile(filePath)]);
  } catch (error) {
    return [issue('unreadable', filePath, error instanceof Error ? error.message : 'Unreadable image')];
  }

  if (metadata.format !== 'webp') errors.push(issue('format', filePath, 'Asset must be WebP'));
  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    errors.push(
      issue(
        'dimensions',
        filePath,
        `Expected ${expected.width}x${expected.height}, got ${metadata.width ?? '?'}x${metadata.height ?? '?'}`
      )
    );
  }
  if (!metadata.width || metadata.width / 128 !== expected.frames) {
    errors.push(issue('frame_count', filePath, `Expected ${expected.frames} frames at 128px each`));
  }
  if (bytes.subarray(12, 16).toString('ascii') !== 'VP8L') {
    errors.push(issue('lossless', filePath, 'Asset must use lossless VP8L encoding'));
  }

  try {
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let hasTransparentPixel = false;
    let hasVisiblePixel = false;
    for (let index = 3; index < data.length; index += info.channels) {
      const alpha = data[index];
      if (alpha < 255) hasTransparentPixel = true;
      if (alpha > 0) hasVisiblePixel = true;
      if (hasTransparentPixel && hasVisiblePixel) break;
    }
    if (!metadata.hasAlpha || !hasTransparentPixel || !hasVisiblePixel) {
      errors.push(issue('alpha', filePath, 'Asset must contain visible pixels and genuine transparency'));
    }
  } catch (error) {
    errors.push(issue('unreadable', filePath, error instanceof Error ? error.message : 'Unreadable alpha channel'));
  }

  return errors;
}

export async function validateDungeonEquipmentProductionAssets(options = {}) {
  const assetRoot = options.assetRoot ?? path.join(projectRoot, DUNGEON_EQUIPMENT_PRODUCTION_ASSET_DIRECTORY);
  const strictRelease = options.strictRelease ?? true;
  const baseManifest = options.baseManifest ?? DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST;
  const equipmentManifest = options.equipmentManifest ?? DUNGEON_EQUIPMENT_ASSET_MANIFEST;
  const errors = [
    ...validateDungeonEquipmentProductionManifest({ baseManifest, equipmentManifest }),
    ...(await validateDungeonEquipmentProductionTree(assetRoot, { strictRelease })),
  ];

  for (const [relative, contract] of DUNGEON_EQUIPMENT_PRODUCTION_EXPECTED_FILES) {
    const filePath = path.join(assetRoot, ...relative.split('/'));
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) {
        errors.push(issue('missing_file', relative, 'Required production asset is not a regular file'));
        continue;
      }
    } catch {
      continue;
    }
    errors.push(...(await validateDungeonEquipmentProductionSheet(filePath, contract)));
  }

  const aggregate = await calculateDungeonEquipmentAssetAggregate(assetRoot);
  return { errors, ...aggregate };
}

async function runCli() {
  const result = await validateDungeonEquipmentProductionAssets({ strictRelease: true });
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`[${error.code}] ${error.file}: ${error.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Dungeon equipment production assets passed: ${result.fileCount} WebP, ${result.totalBytes} bytes, SHA-256 ${result.aggregateSha256}.`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
