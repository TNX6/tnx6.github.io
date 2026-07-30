#!/usr/bin/env node

/**
 * Universal LPC dungeon-loot asset planner/generator.
 *
 * The default and safest mode is --plan-only. It reads index metadata, resolves
 * deterministic source/fallback choices, validates every referenced path, and
 * writes reports without decoding or creating PNG files.
 *
 * --generate is intentionally explicit. It consumes the same validated plan and
 * writes only the selected item subset below the requested generated asset root.
 */

import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const VALID_SLOTS = new Set(['weapon', 'helmet', 'armor', 'boots']);
const VALID_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const BODY_PRIORITY = ['male', 'universal', 'adult'];
const OTHER_BODY_PRIORITY = ['unknown', 'female', 'muscular', 'teen', 'pregnant', 'child'];
const LAYER_ORDER = ['behind', 'bg', 'main', 'fg', 'front'];
const MATERIAL_VARIANT_PRIORITY = [
  'rust',
  'rusty',
  'leather',
  'brown',
  'darkbrown',
  'black',
  'charcoal',
  'iron',
  'steel',
  'silver',
  'gray',
  'grey',
  'bronze',
  'brass',
  'copper',
  'gold',
  'white',
  'red',
  'blue',
  'green',
];
const CLOSEST_POSE_BY_TARGET = {
  idle: ['combat', 'spellcast', 'slash', 'thrust', 'shoot', 'unknown'],
  walk: ['combat', 'slash', 'thrust', 'shoot', 'spellcast', 'unknown'],
  hurt: [],
};
const OUTPUT_FILES = {
  layered: [
    'idle-back.png',
    'idle-front.png',
    'walk-back.png',
    'walk-front.png',
    'hurt-back.png',
    'hurt-front.png',
    'idle-breathe-back.png',
    'idle-breathe-front.png',
    'source-manifest.json',
    'credits.txt',
  ],
  main: [
    'idle.png',
    'walk.png',
    'hurt.png',
    'idle-breathe.png',
    'source-manifest.json',
    'credits.txt',
  ],
};

const DEFAULTS = {
  catalog: path.join(PROJECT_ROOT, '.temp/lpc-final-loot-catalog/loot-catalog.json'),
  index: path.join(PROJECT_ROOT, '.temp/lpc-library-index/asset-families.json'),
  filesIndex: path.join(PROJECT_ROOT, '.temp/lpc-library-index/library-files.json'),
  curated: path.join(PROJECT_ROOT, '.temp/lpc-library-curated/curated-families.json'),
  out: path.join(PROJECT_ROOT, '.temp/lpc-generation-plan'),
  approvedPlan: path.join(
    PROJECT_ROOT,
    '.temp/lpc-generation-plan/generation-plan.json',
  ),
  generatedRoot: path.join(
    PROJECT_ROOT,
    'public/assets/dungeon-overlay/lpc-v1/generated',
  ),
  source: null,
  concurrency: 12,
};

const GENERIC_FALLBACKS = {
  weapon: {
    folder: 'public/assets/dungeon-overlay/lpc-v1/equipment/test-weapon',
    layered: true,
    files: {
      idle: ['idle-back.png', 'idle-front.png'],
      walk: ['walk-back.png', 'walk-front.png'],
      hurt: ['hurt-back.png', 'hurt-front.png'],
    },
  },
  helmet: {
    folder: 'public/assets/dungeon-overlay/lpc-v1/equipment/test-helmet',
    layered: false,
    files: { idle: ['idle.png'], walk: ['walk.png'], hurt: ['hurt.png'] },
  },
  armor: {
    folder: 'public/assets/dungeon-overlay/lpc-v1/equipment/test-armor',
    layered: false,
    files: { idle: ['idle.png'], walk: ['walk.png'], hurt: ['hurt.png'] },
  },
  boots: {
    folder: 'public/assets/dungeon-overlay/lpc-v1/equipment/test-boots',
    layered: false,
    files: { idle: ['idle.png'], walk: ['walk.png'], hurt: ['hurt.png'] },
  },
};

function usage() {
  return `
Usage:
  node scripts/lpc-loot-asset-generator.mjs [options]

Modes:
  --plan-only                  Write metadata reports only (default)
  --generate                   Generate the selected, validated asset subset

Filters:
  --item <internalItemId>
  --slot <weapon|helmet|armor|boots>
  --rarity <common|uncommon|rare|epic|legendary>

Paths:
  --catalog <loot-catalog.json>
  --index <asset-families.json>
  --files-index <library-files.json>
  --curated <curated-families.json>
  --source <spritesheets-root>
  --out <plan-report-directory>
  --plan <approved-generation-plan.json>
  --generated-root <generated-assets-directory>

Generation:
  --force
  --concurrency <number>
  --help
`.trim();
}

function parseArguments(argv) {
  const options = {
    ...DEFAULTS,
    mode: 'plan-only',
    force: false,
    generatedRootExplicit: false,
    item: null,
    slot: null,
    rarity: null,
  };
  const pathFlags = new Map([
    ['--catalog', 'catalog'],
    ['--index', 'index'],
    ['--files-index', 'filesIndex'],
    ['--curated', 'curated'],
    ['--source', 'source'],
    ['--out', 'out'],
    ['--plan', 'approvedPlan'],
    ['--generated-root', 'generatedRoot'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (argument === '--plan-only') {
      options.mode = 'plan-only';
      continue;
    }
    if (argument === '--generate') {
      options.mode = 'generate';
      continue;
    }
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (pathFlags.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path value.`);
      }
      options[pathFlags.get(argument)] = path.resolve(PROJECT_ROOT, value);
      if (argument === '--generated-root') options.generatedRootExplicit = true;
      index += 1;
      continue;
    }
    if (argument === '--item' || argument === '--slot' || argument === '--rarity') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument === '--concurrency') {
      const value = Number.parseInt(argv[index + 1], 10);
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        throw new Error('--concurrency must be an integer from 1 to 64.');
      }
      options.concurrency = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.slot && !VALID_SLOTS.has(options.slot)) {
    throw new Error(`Unsupported slot filter: ${options.slot}`);
  }
  if (options.rarity && !VALID_RARITIES.has(options.rarity)) {
    throw new Error(`Unsupported rarity filter: ${options.rarity}`);
  }
  if (options.mode === 'generate' && !options.generatedRootExplicit) {
    options.generatedRoot = options.out;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function normalizeRelative(relativePath) {
  return String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function toProjectRelative(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return normalizeRelative(relative);
}

function shortHash(value, length = 12) {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/_+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value) ?? 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function csvCell(value) {
  const serialized =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return `"${serialized.replaceAll('"', '""')}"`;
}

function renderCsv(rows, columns) {
  const lines = [columns.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function mapBounded(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < values.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(values[current], current);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, runWorker),
  );
  return results;
}

function selectBodyType(family) {
  const available = unique(family.availableBodyTypes || []).filter(Boolean);
  for (const preferred of BODY_PRIORITY) {
    if (available.includes(preferred)) {
      return {
        selected: preferred,
        method: 'preferred-order',
        warning: null,
      };
    }
  }
  for (const candidate of OTHER_BODY_PRIORITY) {
    if (available.includes(candidate)) {
      return {
        selected: candidate,
        method: 'closest-indexed-compatible-source',
        warning: `Preferred male/universal/adult body is unavailable; selected ${candidate}.`,
      };
    }
  }
  const selected = [...available].sort()[0] || null;
  return {
    selected,
    method: selected ? 'deterministic-indexed-fallback' : 'unavailable',
    warning: selected
      ? `Selected deterministic fallback body ${selected}.`
      : 'No indexed body type is available.',
  };
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function selectVariant(item, family) {
  const variants = unique(family.availableVariants || [])
    .filter((value) => value && value !== 'unknown')
    .sort();
  const requested = String(item.variant || '').trim() || null;
  if (requested && variants.includes(requested)) {
    return {
      requested,
      selected: requested,
      method: 'catalog',
      reason: 'The catalog variant exists in the indexed family.',
      warning: null,
      blockingError: null,
    };
  }
  if (requested && variants.length === 0) {
    return {
      requested,
      selected: null,
      method: 'invalid-no-replacement',
      reason: 'The catalog requested a variant but the family has no indexed variants.',
      warning: null,
      blockingError: `Selected variant "${requested}" is invalid and no deterministic replacement exists.`,
    };
  }
  if (variants.length === 0) {
    return {
      requested,
      selected: null,
      method: 'not-applicable',
      reason: 'This family has no indexed color/material variants.',
      warning: requested ? `Ignored unavailable variant "${requested}".` : null,
      blockingError: null,
    };
  }

  const contextTokens = new Set([
    ...tokenize(item.internalItemId),
    ...tokenize(item.sourceFamilyPath),
    ...tokenize(family.normalizedFamilyPath),
    ...(family.semanticTags || []).flatMap(tokenize),
  ]);
  const implied =
    MATERIAL_VARIANT_PRIORITY.find(
      (candidate) => variants.includes(candidate) && contextTokens.has(candidate),
    ) ||
    variants.find((variant) => contextTokens.has(variant)) ||
    null;
  if (implied) {
    return {
      requested,
      selected: implied,
      method: 'auto-material-or-color',
      reason: `Variant "${implied}" is implied by the item ID, source path, or semantic tags.`,
      warning: requested
        ? `Requested variant "${requested}" was unavailable; selected "${implied}" deterministically.`
        : null,
      blockingError: null,
    };
  }

  const representative =
    MATERIAL_VARIANT_PRIORITY.find((candidate) => variants.includes(candidate)) || variants[0];
  return {
    requested,
    selected: representative,
    method: 'auto-indexed-representative',
    reason: `Selected the deterministic indexed representative "${representative}".`,
    warning: requested
      ? `Requested variant "${requested}" was unavailable; selected "${representative}" deterministically.`
      : null,
    blockingError: null,
  };
}

function isLayeredFamily(family) {
  const layers = new Set(family.availableLayers || []);
  return (
    layers.has('bg') ||
    layers.has('fg') ||
    layers.has('behind') ||
    layers.has('front')
  );
}

function layerRank(role) {
  const index = LAYER_ORDER.indexOf(role);
  return index === -1 ? LAYER_ORDER.length : index;
}

function pathRank(source, animation) {
  const relative = normalizeRelative(source.relativeSourcePath);
  const basename = path.posix.basename(relative, '.png').toLowerCase();
  let score = 0;
  if (basename === animation) score += 100;
  if (relative.includes(`/${animation}/`)) score += 50;
  if (source.paletteVariant === 'unknown') score += 5;
  score -= relative.length / 10000;
  return score;
}

function chooseOnePerLayer(sources, animation, selectedVariant, exactVariantOnly = false) {
  const byLayer = new Map();
  for (const source of sources) {
    const role = source.layerRole || 'main';
    if (!byLayer.has(role)) byLayer.set(role, []);
    byLayer.get(role).push(source);
  }
  const selected = [];
  for (const [role, candidates] of byLayer) {
    const exact = selectedVariant
      ? candidates.filter((source) => source.paletteVariant === selectedVariant)
      : [];
    const neutral = candidates.filter(
      (source) => !source.paletteVariant || source.paletteVariant === 'unknown',
    );
    let pool;
    if (selectedVariant) {
      pool = exact.length > 0 ? exact : exactVariantOnly ? [] : neutral;
    } else {
      pool = neutral.length > 0 ? neutral : candidates;
    }
    if (pool.length === 0) continue;
    pool.sort((a, b) => {
      const score = pathRank(b, animation) - pathRank(a, animation);
      return score || normalizeRelative(a.relativeSourcePath).localeCompare(
        normalizeRelative(b.relativeSourcePath),
      );
    });
    selected.push({ ...pool[0], layerRole: role });
  }
  return selected.sort(
    (a, b) =>
      layerRank(a.layerRole) - layerRank(b.layerRole) ||
      normalizeRelative(a.relativeSourcePath).localeCompare(
        normalizeRelative(b.relativeSourcePath),
      ),
  );
}

function selectFamilyAnimationSources(
  family,
  animation,
  bodyType,
  variant,
  { allowClosestVariant = true } = {},
) {
  const animationSources = (family.sourceFiles || []).filter(
    (source) => source.animation === animation && source.bodyType === bodyType,
  );
  if (animationSources.length === 0) return [];
  const exact = chooseOnePerLayer(animationSources, animation, variant, true);
  if (variant && exact.length > 0) return exact;
  if (variant && !allowClosestVariant) return [];
  return chooseOnePerLayer(animationSources, animation, variant, false);
}

function selectClosestPoseSources(family, target, bodyType, variant) {
  for (const animation of CLOSEST_POSE_BY_TARGET[target] || []) {
    const sources = selectFamilyAnimationSources(
      family,
      animation,
      bodyType,
      variant,
      { allowClosestVariant: true },
    );
    if (sources.length > 0) return { animation, sources };
  }
  return null;
}

function familyMaterialTokens(family, variant) {
  return new Set([
    ...(family.semanticTags || []).flatMap(tokenize),
    ...tokenize(family.normalizedFamilyPath),
    ...tokenize(variant),
  ]);
}

function chooseSameSlotHurtFamily(targetFamily, families, bodyType, variant) {
  const targetTokens = familyMaterialTokens(targetFamily, variant);
  const candidates = [];
  for (const family of families) {
    if (
      family.familyId === targetFamily.familyId ||
      family.currentDungeonSlot !== targetFamily.currentDungeonSlot ||
      !family.hurtSupport
    ) {
      continue;
    }
    const donorBody = selectBodyType(family).selected;
    if (!donorBody) continue;
    const donorVariant = selectVariant({}, family).selected;
    const sources = selectFamilyAnimationSources(
      family,
      'hurt',
      family.availableBodyTypes?.includes(bodyType) ? bodyType : donorBody,
      donorVariant,
      { allowClosestVariant: true },
    );
    if (sources.length === 0) continue;
    const donorTokens = familyMaterialTokens(family, donorVariant);
    const sharedTokens = [...targetTokens].filter((token) => donorTokens.has(token)).length;
    let score = sharedTokens * 20;
    if (family.dungeonTheme === targetFamily.dungeonTheme) score += 40;
    if (family.libraryCategory === targetFamily.libraryCategory) score += 20;
    if (family.availableBodyTypes?.includes(bodyType)) score += 10;
    score += Number(family.dungeonSuitabilityScore || 0) / 100;
    candidates.push({ family, bodyType: sources[0].bodyType, variant: donorVariant, sources, score });
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.family.familyId.localeCompare(b.family.familyId),
  );
  return candidates[0] || null;
}

function genericFallbackSources(slot, animation) {
  const fallback = GENERIC_FALLBACKS[slot];
  if (!fallback) return [];
  return (fallback.files[animation] || []).map((filename, index, filenames) => {
    const absolutePath = path.join(PROJECT_ROOT, fallback.folder, filename);
    const role = fallback.layered
      ? filename.includes('back')
        ? 'bg'
        : 'fg'
      : 'main';
    return {
      sourceKind: 'existing-generic-production-lpc',
      familyId: `generic-${slot}`,
      relativeSourcePath: normalizeRelative(path.join(fallback.folder, filename)),
      absoluteSourcePath: absolutePath,
      animation,
      bodyType: 'universal',
      layerRole: role,
      paletteVariant: 'generic',
      width: null,
      height: null,
      columns: null,
      rows: null,
      appearsTransparent: true,
      fileSizeBytes: null,
      genericPartIndex: index,
      genericPartCount: filenames.length,
    };
  });
}

function resolveAnimationPlan({
  target,
  family,
  families,
  slot,
  bodyType,
  variant,
}) {
  const nativeExact = selectFamilyAnimationSources(
    family,
    target,
    bodyType,
    variant,
    { allowClosestVariant: false },
  );
  const nativeAnyVariant = selectFamilyAnimationSources(
    family,
    target,
    bodyType,
    variant,
    { allowClosestVariant: true },
  );

  if (nativeExact.length > 0 || (!variant && nativeAnyVariant.length > 0)) {
    const sources = nativeExact.length > 0 ? nativeExact : nativeAnyVariant;
    return {
      targetAnimation: target,
      sourceAnimation: target,
      quality: 'native',
      strategy: `Use native ${target} sources for the selected family, body, and variant.`,
      transformation: 'native-sheet',
      sources,
      donorFamilyId: family.familyId,
    };
  }

  if (target === 'hurt' && nativeAnyVariant.length > 0) {
    return {
      targetAnimation: target,
      sourceAnimation: target,
      quality: 'same-family-fallback',
      strategy:
        'Use native hurt from the same family/body with the closest deterministic variant.',
      transformation: 'native-sheet',
      sources: nativeAnyVariant,
      donorFamilyId: family.familyId,
    };
  }

  if (target === 'idle') {
    const walk = selectFamilyAnimationSources(
      family,
      'walk',
      bodyType,
      variant,
      { allowClosestVariant: true },
    );
    if (walk.length > 0) {
      return {
        targetAnimation: target,
        sourceAnimation: 'walk',
        quality: 'degraded-static',
        strategy:
          'Copy the first compatible frame from every walk direction into a static two-column idle sheet.',
        transformation: 'first-direction-frame-to-static-idle',
        sources: walk,
        donorFamilyId: family.familyId,
      };
    }
  }

  if (target === 'walk') {
    const idle = selectFamilyAnimationSources(
      family,
      'idle',
      bodyType,
      variant,
      { allowClosestVariant: true },
    );
    if (idle.length > 0) {
      return {
        targetAnimation: target,
        sourceAnimation: 'idle',
        quality: 'degraded-static',
        strategy:
          'Repeat the selected static idle pose across all nine frames of each walk direction.',
        transformation: 'repeat-static-idle-to-walk',
        sources: idle,
        donorFamilyId: family.familyId,
      };
    }
  }

  const closestPose = selectClosestPoseSources(family, target, bodyType, variant);
  if (closestPose) {
    return {
      targetAnimation: target,
      sourceAnimation: closestPose.animation,
      quality: 'same-family-fallback',
      strategy: `Normalize the closest same-family ${closestPose.animation} pose into the ${target} layout.`,
      transformation:
        target === 'walk'
          ? 'repeat-first-pose-frame-to-walk'
          : 'first-direction-frame-to-static-idle',
      sources: closestPose.sources,
      donorFamilyId: family.familyId,
    };
  }

  if (target === 'hurt') {
    const sameSlot = chooseSameSlotHurtFamily(family, families, bodyType, variant);
    if (sameSlot) {
      return {
        targetAnimation: target,
        sourceAnimation: 'hurt',
        quality: 'same-slot-fallback',
        strategy: `Use hurt from compatible ${slot} family ${sameSlot.family.familyId}; it is not visually identical to the selected family.`,
        transformation: 'native-sheet',
        sources: sameSlot.sources,
        donorFamilyId: sameSlot.family.familyId,
      };
    }
  }

  const generic = genericFallbackSources(slot, target);
  if (generic.length > 0) {
    return {
      targetAnimation: target,
      sourceAnimation: target,
      quality: 'generic-fallback',
      strategy: `Use the existing generic production LPC ${slot} ${target} fallback; it is not visually identical to the selected family.`,
      transformation: 'native-sheet',
      sources: generic,
      donorFamilyId: `generic-${slot}`,
    };
  }

  return {
    targetAnimation: target,
    sourceAnimation: null,
    quality: 'blocking',
    strategy: `No ${target} source or ${slot} fallback exists.`,
    transformation: null,
    sources: [],
    donorFamilyId: null,
  };
}

function enrichSource(source, familyById, fileMetadataByPath, sourceRoot) {
  const relativeSourcePath = normalizeRelative(source.relativeSourcePath);
  const isGeneric = source.sourceKind === 'existing-generic-production-lpc';
  const absoluteSourcePath = isGeneric
    ? source.absoluteSourcePath
    : path.resolve(sourceRoot, ...relativeSourcePath.split('/'));
  const metadata = fileMetadataByPath.get(relativeSourcePath);
  const family = familyById.get(source.familyId);
  return {
    sourceKind: isGeneric ? source.sourceKind : 'universal-lpc-library',
    familyId: source.familyId,
    relativeSourcePath,
    absoluteSourcePath,
    animation: source.animation,
    bodyType: source.bodyType,
    layerRole: source.layerRole || 'main',
    variant:
      source.paletteVariant && source.paletteVariant !== 'unknown'
        ? source.paletteVariant
        : null,
    width: metadata?.width ?? source.width ?? null,
    height: metadata?.height ?? source.height ?? null,
    columns: metadata?.columns ?? source.columns ?? null,
    rows: metadata?.rows ?? source.rows ?? null,
    fileSizeBytes: metadata?.fileSizeBytes ?? source.fileSizeBytes ?? null,
    appearsTransparent:
      metadata?.appearsTransparent ?? source.appearsTransparent ?? null,
    indexedUnreadable: metadata?.unreadable ?? false,
    indexedMalformed: metadata?.malformed ?? false,
    creditsKey: metadata?.creditsKey ?? relativeSourcePath,
    authors: family?.authors || [],
    licenses: family?.licenses || [],
  };
}

function plannedFilesForItem(item, layered, generatedRoot) {
  const outputDirectory = path.join(generatedRoot, item.internalItemId);
  return (layered ? OUTPUT_FILES.layered : OUTPUT_FILES.main).map((filename) => ({
    filename,
    relativeOutputPath: toProjectRelative(path.join(outputDirectory, filename)),
    absoluteOutputPath: path.join(outputDirectory, filename),
    type: filename.endsWith('.png')
      ? 'png'
      : filename.endsWith('.json')
        ? 'manifest'
        : 'credits',
  }));
}

function estimateItemBytes(animationPlans, layered) {
  const pngMultiplier = layered ? 2 : 1;
  let total = 0;
  for (const animation of ['idle', 'walk', 'hurt']) {
    const plan = animationPlans[animation];
    const sourceBytes = sum(
      plan.sources.map((source) => Number(source.fileSizeBytes || 0)),
    );
    total += Math.max(1024, sourceBytes || 4096);
    if (layered && plan.sources.length === 1) {
      total += Math.max(512, Math.round((sourceBytes || 4096) * 0.15));
    }
  }
  const idleBytes = Math.max(
    1024,
    sum(animationPlans.idle.sources.map((source) => Number(source.fileSizeBytes || 0))) ||
      4096,
  );
  total += idleBytes * pngMultiplier;
  total += 4096;
  return Math.round(total);
}

function flattenPlanSources(animationPlans) {
  const sources = [];
  for (const animation of ['idle', 'walk', 'hurt']) {
    for (const source of animationPlans[animation].sources) {
      sources.push(source);
    }
  }
  const byPath = new Map();
  for (const source of sources) byPath.set(source.absoluteSourcePath, source);
  return [...byPath.values()].sort((a, b) =>
    a.absoluteSourcePath.localeCompare(b.absoluteSourcePath),
  );
}

function selectedLayerSummary(animationPlans) {
  const result = {};
  for (const animation of ['idle', 'walk', 'hurt']) {
    result[animation] = animationPlans[animation].sources.map((source) => ({
      layer: source.layerRole,
      source: source.relativeSourcePath,
      sourceKind: source.sourceKind,
    }));
  }
  return result;
}

function createVisualIdentity(familyId, variant, bodyType, layered) {
  const key = [familyId, variant || 'default', bodyType || 'unknown', layered ? 'layered' : 'main'].join(
    '|',
  );
  return {
    key,
    id: `lpc-visual-${slug(familyId).slice(0, 52)}-${shortHash(key, 10)}`,
  };
}

function addWarning(target, warning) {
  if (warning && !target.includes(warning)) target.push(warning);
}

function createItemPlan({
  item,
  family,
  families,
  familyById,
  fileMetadataByPath,
  sourceRoot,
  generatedRoot,
  duplicateIds,
  curatedFamilyIds,
}) {
  const warnings = [...(item.warnings || [])];
  const blockingErrors = [];
  if (!family) {
    blockingErrors.push(`Family ID does not exist: ${item.familyId}`);
    return {
      internalItemId: item.internalItemId,
      familyId: item.familyId,
      displayNameAr: item.displayNameAr,
      displayNameEn: item.displayNameEn,
      slot: item.slot || null,
      rarity: item.rarity || null,
      variant: null,
      bodyType: null,
      lpcVisualId: null,
      selectedSourceFiles: [],
      selectedIdleSources: [],
      selectedWalkSources: [],
      selectedHurtSources: [],
      selectedLayers: { idle: [], walk: [], hurt: [] },
      plannedOutputFiles: [],
      nativeAnimationSupport: { idle: false, walk: false, hurt: false },
      fallbackStrategy: {},
      expectedOutputFileCount: 0,
      estimatedOutputBytes: 0,
      creditsAndLicenses: { authors: [], licenses: [], creditsSources: [] },
      warnings,
      blockingErrors,
      generationStatus: 'blocked',
    };
  }

  if (!VALID_SLOTS.has(item.slot)) {
    blockingErrors.push(`Item has an invalid or missing slot: ${item.slot ?? 'missing'}`);
  }
  if (duplicateIds.has(item.internalItemId)) {
    blockingErrors.push(`Output ID is duplicated: ${item.internalItemId}`);
  }
  const familyReadableSources = (family.sourceFiles || []).filter((source) => {
    const metadata = fileMetadataByPath.get(normalizeRelative(source.relativeSourcePath));
    return !metadata?.unreadable && !metadata?.malformed;
  });
  if (familyReadableSources.length === 0) {
    blockingErrors.push('All indexed family source images are missing, malformed, or unreadable.');
  }

  const bodySelection = selectBodyType(family);
  const variantSelection = selectVariant(item, family);
  addWarning(warnings, bodySelection.warning);
  addWarning(warnings, variantSelection.warning);
  if (!bodySelection.selected) {
    blockingErrors.push('No compatible indexed body source exists.');
  }
  if (variantSelection.blockingError) {
    blockingErrors.push(variantSelection.blockingError);
  }

  const animationPlans = {};
  for (const animation of ['idle', 'walk', 'hurt']) {
    const rawPlan = resolveAnimationPlan({
      target: animation,
      family,
      families,
      slot: item.slot,
      bodyType: bodySelection.selected,
      variant: variantSelection.selected,
    });
    animationPlans[animation] = {
      ...rawPlan,
      sources: rawPlan.sources.map((source) =>
        enrichSource(
          {
            ...source,
            familyId: source.familyId || rawPlan.donorFamilyId,
          },
          familyById,
          fileMetadataByPath,
          sourceRoot,
        ),
      ),
    };
    if (rawPlan.quality !== 'native') {
      addWarning(
        warnings,
        `${animation}: ${rawPlan.quality} — ${rawPlan.strategy}`,
      );
    }
    if (rawPlan.quality === 'blocking' || rawPlan.sources.length === 0) {
      blockingErrors.push(`No usable ${animation} strategy exists.`);
    }
  }

  const layered = isLayeredFamily(family);
  const visualIdentity = createVisualIdentity(
    family.familyId,
    variantSelection.selected,
    bodySelection.selected,
    layered,
  );
  const plannedOutputFiles = plannedFilesForItem(item, layered, generatedRoot);
  const selectedSources = flattenPlanSources(animationPlans);
  const creditFamilies = unique(
    selectedSources
      .filter((source) => !source.familyId.startsWith('generic-'))
      .map((source) => source.familyId),
  )
    .map((familyId) => familyById.get(familyId))
    .filter(Boolean);
  const nativeAnimationSupport = Object.fromEntries(
    ['idle', 'walk', 'hurt'].map((animation) => [
      animation,
      animationPlans[animation].quality === 'native',
    ]),
  );
  const generationStatus =
    blockingErrors.length > 0
      ? 'blocked'
      : Object.values(nativeAnimationSupport).every(Boolean)
        ? 'ready-native'
        : 'ready-with-fallback';

  return {
    internalItemId: item.internalItemId,
    familyId: item.familyId,
    displayNameAr: item.displayNameAr,
    displayNameEn: item.displayNameEn,
    slot: item.slot,
    rarity: item.rarity,
    variant: variantSelection.selected,
    variantSelection,
    bodyType: bodySelection.selected,
    bodySelection,
    compatibility: item.compatibility || family.compatibility || 'unknown',
    suitability: item.suitability || family.dungeonSuitability || 'unknown',
    theme: item.theme || family.dungeonTheme || 'unknown',
    curated: curatedFamilyIds.has(item.familyId),
    layered,
    lpcVisualId: visualIdentity.id,
    visualIdentityKey: visualIdentity.key,
    sourceFamilyPath: item.sourceFamilyPath || family.normalizedFamilyPath,
    exactSelectedSourceFiles: selectedSources.map((source) => source.absoluteSourcePath),
    selectedSourceFiles: selectedSources,
    selectedIdleSources: animationPlans.idle.sources,
    selectedWalkSources: animationPlans.walk.sources,
    selectedHurtSources: animationPlans.hurt.sources,
    selectedLayers: selectedLayerSummary(animationPlans),
    plannedOutputDirectory: path.join(generatedRoot, item.internalItemId),
    plannedOutputFiles,
    nativeAnimationSupport,
    fallbackStrategy: Object.fromEntries(
      ['idle', 'walk', 'hurt'].map((animation) => [
        animation,
        {
          quality: animationPlans[animation].quality,
          strategy: animationPlans[animation].strategy,
          sourceAnimation: animationPlans[animation].sourceAnimation,
          transformation: animationPlans[animation].transformation,
          donorFamilyId: animationPlans[animation].donorFamilyId,
        },
      ]),
    ),
    expectedOutputFileCount: plannedOutputFiles.length,
    estimatedOutputBytes: estimateItemBytes(animationPlans, layered),
    creditsAndLicenses: {
      authors: unique(creditFamilies.flatMap((entry) => entry.authors || [])).sort(),
      licenses: unique(creditFamilies.flatMap((entry) => entry.licenses || [])).sort(),
      creditsSources: unique(
        creditFamilies
          .map((entry) => entry.creditsSourcePath)
          .filter(Boolean),
      ).sort(),
      sourceCreditKeys: unique(
        selectedSources.map((source) => source.creditsKey).filter(Boolean),
      ).sort(),
    },
    warnings,
    blockingErrors,
    generationStatus,
  };
}

async function hydrateSourcePathState(items, concurrency) {
  const sourcesByPath = new Map();
  for (const item of items) {
    for (const source of item.selectedSourceFiles || []) {
      sourcesByPath.set(source.absoluteSourcePath, source);
    }
  }
  const results = await mapBounded(
    [...sourcesByPath.values()],
    concurrency,
    async (source) => {
      try {
        await access(source.absoluteSourcePath);
        const fileStat = await stat(source.absoluteSourcePath);
        return {
          path: source.absoluteSourcePath,
          exists: fileStat.isFile(),
          readable: fileStat.isFile() && !source.indexedUnreadable,
          fileSizeBytes: fileStat.size,
          error: fileStat.isFile() ? null : 'Path is not a regular file.',
        };
      } catch (error) {
        return {
          path: source.absoluteSourcePath,
          exists: false,
          readable: false,
          fileSizeBytes: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  const stateByPath = new Map(results.map((result) => [result.path, result]));
  for (const item of items) {
    for (const source of item.selectedSourceFiles || []) {
      const state = stateByPath.get(source.absoluteSourcePath);
      Object.assign(source, state);
    }
    for (const key of ['selectedIdleSources', 'selectedWalkSources', 'selectedHurtSources']) {
      item[key] = (item[key] || []).map((source) => {
        const canonical = (item.selectedSourceFiles || []).find(
          (candidate) => candidate.absoluteSourcePath === source.absoluteSourcePath,
        );
        return canonical || source;
      });
    }
    const missing = (item.selectedSourceFiles || []).filter(
      (source) => !source.exists || !source.readable,
    );
    if (missing.length > 0) {
      item.blockingErrors.push(
        `Referenced source paths are missing or unreadable: ${missing
          .map((source) => source.absoluteSourcePath)
          .join(', ')}`,
      );
      item.generationStatus = 'blocked';
    }
    item.estimatedOutputBytes = estimateItemBytes(
      {
        idle: { sources: item.selectedIdleSources || [] },
        walk: { sources: item.selectedWalkSources || [] },
        hurt: { sources: item.selectedHurtSources || [] },
      },
      item.layered,
    );
  }
  return results;
}

function buildVisualSharing(items, generatedRoot) {
  const groups = new Map();
  for (const item of items) {
    if (!item.lpcVisualId) continue;
    if (!groups.has(item.lpcVisualId)) {
      groups.set(item.lpcVisualId, {
        lpcVisualId: item.lpcVisualId,
        visualIdentityKey: item.visualIdentityKey,
        familyId: item.familyId,
        variant: item.variant,
        bodyType: item.bodyType,
        layered: item.layered,
        itemIds: [],
        itemCount: 0,
        expectedOutputFileCount: item.expectedOutputFileCount,
        estimatedOutputBytes: item.estimatedOutputBytes,
        canonicalOutputDirectory: item.plannedOutputDirectory,
        sharingRecommendation: 'dedicated-item-folder',
      });
    }
    groups.get(item.lpcVisualId).itemIds.push(item.internalItemId);
  }
  for (const group of groups.values()) {
    group.itemIds.sort();
    group.itemCount = group.itemIds.length;
    if (group.itemCount > 1) {
      group.canonicalOutputDirectory = path.join(
        generatedRoot,
        '_visuals',
        group.lpcVisualId,
      );
      group.sharingRecommendation =
        'share-one-generated-visual-through-lpcVisualId; do not duplicate identical PNG files';
    }
  }
  const uniqueVisualAssets = [...groups.values()].sort((a, b) =>
    a.lpcVisualId.localeCompare(b.lpcVisualId),
  );
  const itemToVisualMapping = Object.fromEntries(
    items
      .filter((item) => item.lpcVisualId)
      .sort((a, b) => a.internalItemId.localeCompare(b.internalItemId))
      .map((item) => [item.internalItemId, item.lpcVisualId]),
  );
  return { uniqueVisualAssets, itemToVisualMapping };
}

function summarizePlan(items, uniqueVisualAssets, fullCatalogCount, pathValidation) {
  const fallbackCounts = {
    native: 0,
    'same-family-fallback': 0,
    'same-slot-fallback': 0,
    'generic-fallback': 0,
    'degraded-static': 0,
    blocking: 0,
  };
  const fallbackByAnimation = {
    idle: {},
    walk: {},
    hurt: {},
  };
  for (const item of items) {
    for (const animation of ['idle', 'walk', 'hurt']) {
      const quality = item.fallbackStrategy?.[animation]?.quality || 'blocking';
      fallbackCounts[quality] = (fallbackCounts[quality] || 0) + 1;
      fallbackByAnimation[animation][quality] =
        (fallbackByAnimation[animation][quality] || 0) + 1;
    }
  }
  const uniqueBytes = sum(uniqueVisualAssets.map((entry) => entry.estimatedOutputBytes));
  const uniqueFiles = sum(
    uniqueVisualAssets.map((entry) => entry.expectedOutputFileCount),
  );
  const duplicateVisualCopiesAvoided = sum(
    uniqueVisualAssets.map((entry) =>
      Math.max(0, entry.itemCount - 1) * entry.expectedOutputFileCount,
    ),
  );
  const nativeCounts = {
    idle: items.filter((item) => item.nativeAnimationSupport?.idle).length,
    walk: items.filter((item) => item.nativeAnimationSupport?.walk).length,
    hurt: items.filter((item) => item.nativeAnimationSupport?.hurt).length,
  };
  const largest = [...uniqueVisualAssets]
    .sort((a, b) => b.estimatedOutputBytes - a.estimatedOutputBytes)
    .slice(0, 20)
    .map((entry) => ({
      lpcVisualId: entry.lpcVisualId,
      itemIds: entry.itemIds,
      estimatedOutputBytes: entry.estimatedOutputBytes,
      expectedOutputFileCount: entry.expectedOutputFileCount,
    }));
  return {
    fullCatalogItemCount: fullCatalogCount,
    plannedItemCount: items.length,
    uniqueInternalItemIdCount: new Set(items.map((item) => item.internalItemId)).size,
    uniqueVisualAssetCount: uniqueVisualAssets.length,
    plannedOutputFileCount: uniqueFiles,
    itemFolderFileCountWithoutSharing: sum(
      items.map((item) => item.expectedOutputFileCount),
    ),
    duplicateVisualCopiesAvoided,
    estimatedOutputBytes: uniqueBytes,
    estimatedOutputMiB: Number((uniqueBytes / 1024 / 1024).toFixed(2)),
    bySlot: countBy(items, (item) => item.slot),
    byRarity: countBy(items, (item) => item.rarity),
    byGenerationStatus: countBy(items, (item) => item.generationStatus),
    nativeAnimationCounts: nativeCounts,
    fallbackCountsByQuality: fallbackCounts,
    fallbackCountsByAnimation: fallbackByAnimation,
    blockingErrorCount: sum(items.map((item) => item.blockingErrors.length)),
    blockedItemCount: items.filter((item) => item.blockingErrors.length > 0).length,
    warningCount: sum(items.map((item) => item.warnings.length)),
    warnedItemCount: items.filter((item) => item.warnings.length > 0).length,
    sharedVisualGroupCount: uniqueVisualAssets.filter((entry) => entry.itemCount > 1).length,
    itemsSharingIdenticalVisuals: sum(
      uniqueVisualAssets
        .filter((entry) => entry.itemCount > 1)
        .map((entry) => entry.itemCount),
    ),
    referencedSourceCount: pathValidation.length,
    missingReferencedSourceCount: pathValidation.filter((entry) => !entry.exists).length,
    unreadableReferencedSourceCount: pathValidation.filter(
      (entry) => entry.exists && !entry.readable,
    ).length,
    largestPlannedAssetGroups: largest,
  };
}

function validatePlan({
  items,
  summary,
  filtersActive,
  expectedFullCount,
  itemToVisualMapping,
}) {
  const checks = {
    expectedCatalogItemCount:
      filtersActive || items.length === expectedFullCount,
    uniqueInternalItemIds:
      new Set(items.map((item) => item.internalItemId)).size === items.length,
    everyItemHasSlot: items.every((item) => VALID_SLOTS.has(item.slot)),
    everyItemHasVisualPlan: items.every(
      (item) => item.plannedOutputFiles?.length > 0 || item.blockingErrors?.length > 0,
    ),
    everyItemHasIdleStrategy: items.every(
      (item) => Boolean(item.fallbackStrategy?.idle?.quality),
    ),
    everyItemHasWalkStrategy: items.every(
      (item) => Boolean(item.fallbackStrategy?.walk?.quality),
    ),
    everyItemHasHurtStrategy: items.every(
      (item) => Boolean(item.fallbackStrategy?.hurt?.quality),
    ),
    everyItemMapsToLpcVisualId: items.every(
      (item) =>
        Boolean(item.lpcVisualId) &&
        itemToVisualMapping[item.internalItemId] === item.lpcVisualId,
    ),
    allReferencedSourcePathsExist:
      summary.missingReferencedSourceCount === 0 &&
      summary.unreadableReferencedSourceCount === 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    notes: filtersActive
      ? ['The 682-item count check is not applicable because filters are active.']
      : [],
  };
}

function renderSummaryMarkdown(plan) {
  const summary = plan.summary;
  const lines = [
    '# Universal LPC dungeon-loot generation plan',
    '',
    `Generated: ${plan.generatedAt}`,
    `Mode: ${plan.mode}`,
    '',
    '## Totals',
    '',
    `- Catalog items planned: ${summary.plannedItemCount}`,
    `- Unique internal item IDs: ${summary.uniqueInternalItemIdCount}`,
    `- Unique visual assets: ${summary.uniqueVisualAssetCount}`,
    `- Planned output files after visual sharing: ${summary.plannedOutputFileCount}`,
    `- Output files without sharing: ${summary.itemFolderFileCountWithoutSharing}`,
    `- Duplicate file copies avoided: ${summary.duplicateVisualCopiesAvoided}`,
    `- Estimated output: ${summary.estimatedOutputBytes} bytes (${summary.estimatedOutputMiB} MiB)`,
    `- Blocking errors: ${summary.blockingErrorCount}`,
    `- Warnings: ${summary.warningCount}`,
    '',
    '## Animation coverage',
    '',
    '| Animation | Native |',
    '|---|---:|',
    `| Idle | ${summary.nativeAnimationCounts.idle} |`,
    `| Walk | ${summary.nativeAnimationCounts.walk} |`,
    `| Hurt | ${summary.nativeAnimationCounts.hurt} |`,
    '',
    '## Fallback quality counts',
    '',
    '| Quality | Count |',
    '|---|---:|',
    ...Object.entries(summary.fallbackCountsByQuality).map(
      ([quality, count]) => `| ${quality} | ${count} |`,
    ),
    '',
    '## Items by slot',
    '',
    ...Object.entries(summary.bySlot).map(([slot, count]) => `- ${slot}: ${count}`),
    '',
    '## Items by rarity',
    '',
    ...Object.entries(summary.byRarity).map(
      ([rarity, count]) => `- ${rarity}: ${count}`,
    ),
    '',
    '## Validation',
    '',
    ...Object.entries(plan.validation.checks).map(
      ([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'} — ${name}`,
    ),
    '',
    '## Largest planned visual groups',
    '',
    '| lpcVisualId | Items | Estimated bytes | Files |',
    '|---|---:|---:|---:|',
    ...summary.largestPlannedAssetGroups.map(
      (entry) =>
        `| ${entry.lpcVisualId} | ${entry.itemIds.length} | ${entry.estimatedOutputBytes} | ${entry.expectedOutputFileCount} |`,
    ),
    '',
    'No PNG files are written in plan-only mode.',
    '',
  ];
  return lines.join('\n');
}

function renderFallbackMarkdown(plan) {
  const fallbackItems = plan.items.filter((item) =>
    ['idle', 'walk', 'hurt'].some(
      (animation) => item.fallbackStrategy?.[animation]?.quality !== 'native',
    ),
  );
  const lines = [
    '# LPC animation fallback report',
    '',
    'Fallbacks preserve catalog coverage. They are not claimed to be visually identical to the selected source family.',
    '',
    '## Counts by animation and quality',
    '',
    '| Animation | Quality | Count |',
    '|---|---|---:|',
  ];
  for (const animation of ['idle', 'walk', 'hurt']) {
    for (const [quality, count] of Object.entries(
      plan.summary.fallbackCountsByAnimation[animation],
    )) {
      lines.push(`| ${animation} | ${quality} | ${count} |`);
    }
  }
  lines.push('', `## Items using a fallback (${fallbackItems.length})`, '');
  for (const item of fallbackItems) {
    lines.push(`### ${item.internalItemId}`, '');
    for (const animation of ['idle', 'walk', 'hurt']) {
      const fallback = item.fallbackStrategy[animation];
      if (fallback.quality === 'native') continue;
      lines.push(
        `- ${animation}: **${fallback.quality}** — ${fallback.strategy}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildSizeEstimate(plan) {
  const aggregate = (field) =>
    Object.fromEntries(
      [...new Set(plan.items.map((item) => item[field]))]
        .sort()
        .map((value) => {
          const visualIds = new Set(
            plan.items
              .filter((item) => item[field] === value)
              .map((item) => item.lpcVisualId),
          );
          const visuals = plan.uniqueVisualAssets.filter((entry) =>
            visualIds.has(entry.lpcVisualId),
          );
          return [
            value,
            {
              itemCount: plan.items.filter((item) => item[field] === value).length,
              uniqueVisualCount: visuals.length,
              plannedOutputFiles: sum(
                visuals.map((entry) => entry.expectedOutputFileCount),
              ),
              estimatedOutputBytes: sum(
                visuals.map((entry) => entry.estimatedOutputBytes),
              ),
            },
          ];
        }),
    );
  return {
    generatedAt: plan.generatedAt,
    itemCount: plan.summary.plannedItemCount,
    uniqueVisualAssetCount: plan.summary.uniqueVisualAssetCount,
    plannedOutputFileCount: plan.summary.plannedOutputFileCount,
    itemFolderFileCountWithoutSharing: plan.summary.itemFolderFileCountWithoutSharing,
    duplicateVisualCopiesAvoided: plan.summary.duplicateVisualCopiesAvoided,
    estimatedOutputBytes: plan.summary.estimatedOutputBytes,
    estimatedOutputMiB: plan.summary.estimatedOutputMiB,
    estimatesBySlot: aggregate('slot'),
    estimatesByRarity: aggregate('rarity'),
    nativeVersusFallback: {
      nativeAnimationCounts: plan.summary.nativeAnimationCounts,
      fallbackCountsByQuality: plan.summary.fallbackCountsByQuality,
    },
    familiesReusedByMultipleCatalogItems: plan.uniqueVisualAssets
      .filter((entry) => entry.itemCount > 1)
      .map((entry) => ({
        familyId: entry.familyId,
        lpcVisualId: entry.lpcVisualId,
        itemIds: entry.itemIds,
      })),
    expectedDuplicateVisualAssets: plan.summary.itemsSharingIdenticalVisuals,
    largestPlannedItems: plan.summary.largestPlannedAssetGroups,
  };
}

async function writePlanReports(plan, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const csvRows = plan.items.map((item) => ({
    internalItemId: item.internalItemId,
    familyId: item.familyId,
    displayNameAr: item.displayNameAr,
    displayNameEn: item.displayNameEn,
    slot: item.slot,
    rarity: item.rarity,
    variant: item.variant,
    variantSelectionMethod: item.variantSelection?.method,
    bodyType: item.bodyType,
    bodySelectionMethod: item.bodySelection?.method,
    lpcVisualId: item.lpcVisualId,
    layered: item.layered,
    idleQuality: item.fallbackStrategy?.idle?.quality,
    idleSourceAnimation: item.fallbackStrategy?.idle?.sourceAnimation,
    walkQuality: item.fallbackStrategy?.walk?.quality,
    walkSourceAnimation: item.fallbackStrategy?.walk?.sourceAnimation,
    hurtQuality: item.fallbackStrategy?.hurt?.quality,
    hurtSourceAnimation: item.fallbackStrategy?.hurt?.sourceAnimation,
    nativeIdle: item.nativeAnimationSupport?.idle,
    nativeWalk: item.nativeAnimationSupport?.walk,
    nativeHurt: item.nativeAnimationSupport?.hurt,
    expectedOutputFileCount: item.expectedOutputFileCount,
    estimatedOutputBytes: item.estimatedOutputBytes,
    exactSelectedSourceFiles: item.exactSelectedSourceFiles,
    plannedOutputFiles: item.plannedOutputFiles?.map(
      (entry) => entry.relativeOutputPath,
    ),
    warningCount: item.warnings?.length || 0,
    blockingErrorCount: item.blockingErrors?.length || 0,
    generationStatus: item.generationStatus,
  }));
  const columns = Object.keys(csvRows[0] || {});
  const errors = {
    generatedAt: plan.generatedAt,
    blockingErrorCount: plan.summary.blockingErrorCount,
    blockedItemCount: plan.summary.blockedItemCount,
    validationPassed: plan.validation.passed,
    failedValidationChecks: Object.entries(plan.validation.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    items: plan.items
      .filter((item) => item.blockingErrors.length > 0)
      .map((item) => ({
        internalItemId: item.internalItemId,
        familyId: item.familyId,
        blockingErrors: item.blockingErrors,
      })),
  };
  const files = [
    ['generation-plan.json', `${JSON.stringify(plan, null, 2)}\n`],
    ['generation-plan.csv', renderCsv(csvRows, columns)],
    ['generation-summary.md', renderSummaryMarkdown(plan)],
    ['generation-errors.json', `${JSON.stringify(errors, null, 2)}\n`],
    ['fallback-report.md', renderFallbackMarkdown(plan)],
    ['size-estimate.json', `${JSON.stringify(buildSizeEstimate(plan), null, 2)}\n`],
  ];
  await Promise.all(
    files.map(([filename, content]) =>
      writeFile(path.join(outputDirectory, filename), content, 'utf8'),
    ),
  );
}

function sourceSelectionSignature(item, animation) {
  const field =
    animation === 'idle'
      ? 'selectedIdleSources'
      : animation === 'walk'
        ? 'selectedWalkSources'
        : 'selectedHurtSources';
  return (item[field] || [])
    .map((source) =>
      [
        source.sourceKind,
        source.familyId,
        normalizeRelative(source.relativeSourcePath),
        source.layerRole,
        source.bodyType,
        source.variant || source.paletteVariant || '',
      ].join('|'),
    )
    .sort();
}

function verifyApprovedPlan(items, approvedPlan) {
  const approvedById = new Map(
    (approvedPlan.items || []).map((item) => [item.internalItemId, item]),
  );
  const mismatches = [];
  for (const item of items) {
    const approved = approvedById.get(item.internalItemId);
    if (!approved) {
      mismatches.push(`${item.internalItemId}: missing from approved plan`);
      continue;
    }
    for (const field of ['familyId', 'variant', 'bodyType', 'lpcVisualId']) {
      if ((item[field] ?? null) !== (approved[field] ?? null)) {
        mismatches.push(
          `${item.internalItemId}: ${field} changed (${approved[field] ?? 'null'} -> ${item[field] ?? 'null'})`,
        );
      }
    }
    for (const animation of ['idle', 'walk', 'hurt']) {
      const currentFallback = item.fallbackStrategy?.[animation] || {};
      const approvedFallback = approved.fallbackStrategy?.[animation] || {};
      for (const field of [
        'quality',
        'sourceAnimation',
        'transformation',
        'donorFamilyId',
      ]) {
        if ((currentFallback[field] ?? null) !== (approvedFallback[field] ?? null)) {
          mismatches.push(
            `${item.internalItemId}: ${animation}.${field} changed (${approvedFallback[field] ?? 'null'} -> ${currentFallback[field] ?? 'null'})`,
          );
        }
      }
      const currentSources = sourceSelectionSignature(item, animation);
      const approvedSources = sourceSelectionSignature(approved, animation);
      if (JSON.stringify(currentSources) !== JSON.stringify(approvedSources)) {
        mismatches.push(`${item.internalItemId}: ${animation} selected sources changed`);
      }
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Generation plan drift detected; refusing to silently change approved sources/fallbacks.\n${mismatches
        .slice(0, 50)
        .join('\n')}${mismatches.length > 50 ? `\n...${mismatches.length - 50} more` : ''}`,
    );
  }
  return {
    approvedPlanPath: approvedPlan.inputs?.catalog
      ? approvedPlan.generatedAt
      : null,
    approvedPlanGeneratedAt: approvedPlan.generatedAt,
    matchedItemCount: items.length,
    mismatchCount: 0,
  };
}

function splitSourcesForSide(sources, side, layered) {
  if (!layered) return sources;
  const backRoles = new Set(['behind', 'bg']);
  const frontRoles = new Set(['main', 'fg', 'front']);
  const selected = sources.filter((source) =>
    side === 'back'
      ? backRoles.has(source.layerRole)
      : frontRoles.has(source.layerRole),
  );
  return selected;
}

async function writeSourceManifest(item, outputDirectory) {
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    internalItemId: item.internalItemId,
    lpcVisualId: item.lpcVisualId,
    familyId: item.familyId,
    variant: item.variant,
    bodyType: item.bodyType,
    layered: item.layered,
    nativeAnimationSupport: item.nativeAnimationSupport,
    fallbackStrategy: item.fallbackStrategy,
    selectedLayers: item.selectedLayers,
    selectedSourceFiles: item.selectedSourceFiles,
    creditsAndLicenses: item.creditsAndLicenses,
  };
  await writeFile(
    path.join(outputDirectory, 'source-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

async function writeCredits(item, outputDirectory) {
  const lines = [
    `Universal LPC generated visual for ${item.internalItemId}`,
    '',
    `Family: ${item.familyId}`,
    `Variant: ${item.variant || 'default/unindexed'}`,
    `Body: ${item.bodyType}`,
    '',
    'Authors:',
    ...(item.creditsAndLicenses.authors.length
      ? item.creditsAndLicenses.authors.map((author) => `- ${author}`)
      : ['- See source credit keys below.']),
    '',
    'Licenses:',
    ...item.creditsAndLicenses.licenses.map((license) => `- ${license}`),
    '',
    'Source credit keys:',
    ...item.creditsAndLicenses.sourceCreditKeys.map((key) => `- ${key}`),
    '',
    'Fallback disclosure:',
    ...['idle', 'walk', 'hurt'].map(
      (animation) =>
        `- ${animation}: ${item.fallbackStrategy[animation].quality} — ${item.fallbackStrategy[animation].strategy}`,
    ),
    '',
  ];
  await writeFile(path.join(outputDirectory, 'credits.txt'), lines.join('\n'), 'utf8');
}

function detectedSourceFrameSize(width, height) {
  const supports128 =
    width % 128 === 0 &&
    height % 128 === 0 &&
    width / 128 <= 13 &&
    height / 128 <= 21 &&
    (width / 64 > 13 || height / 64 > 21);
  return supports128 ? 128 : 64;
}

async function analyzeSourceGrid(sharp, sourcePath) {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frameSize = detectedSourceFrameSize(info.width, info.height);
  const columns = Math.floor(info.width / frameSize);
  const rows = Math.floor(info.height / frameSize);
  const occupancy = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => 0),
  );
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let count = 0;
      const startX = column * frameSize;
      const startY = row * frameSize;
      for (let y = startY; y < startY + frameSize; y += 1) {
        let alphaOffset = (y * info.width + startX) * info.channels + 3;
        for (let x = 0; x < frameSize; x += 1) {
          if (data[alphaOffset] > 0) count += 1;
          alphaOffset += info.channels;
        }
      }
      occupancy[row][column] = count;
    }
  }
  return {
    width: info.width,
    height: info.height,
    frameSize,
    columns,
    rows,
    occupancy,
  };
}

function bestRowWindow(grid, targetRows) {
  if (grid.rows <= targetRows) return 0;
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start <= grid.rows - targetRows; start += 1) {
    let score = 0;
    for (let row = start; row < start + targetRows; row += 1) {
      score += sum(grid.occupancy[row]);
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart;
}

function bestColumnWindow(grid, rowStart, targetRows, targetColumns) {
  if (grid.columns <= targetColumns) return 0;
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start <= grid.columns - targetColumns; start += 1) {
    let score = 0;
    for (let row = rowStart; row < Math.min(grid.rows, rowStart + targetRows); row += 1) {
      score += sum(grid.occupancy[row].slice(start, start + targetColumns));
    }
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart;
}

function firstVisibleColumn(grid, row, preferredStart = 0) {
  if (row >= grid.rows) return null;
  for (let column = preferredStart; column < grid.columns; column += 1) {
    if (grid.occupancy[row][column] > 0) return column;
  }
  for (let column = 0; column < preferredStart; column += 1) {
    if (grid.occupancy[row][column] > 0) return column;
  }
  return null;
}

async function normalizeSourceToTarget({
  sharp,
  source,
  target,
  targetAnimation,
  transformation,
}) {
  const grid = await analyzeSourceGrid(sharp, source.absoluteSourcePath);
  const targetRows = target.rows;
  const targetColumns = target.columns;
  const rowStart = bestRowWindow(grid, targetRows);
  const columnStart = bestColumnWindow(
    grid,
    rowStart,
    targetRows,
    Math.min(targetColumns, grid.columns),
  );
  const repeatStatic =
    transformation === 'first-direction-frame-to-static-idle' ||
    transformation === 'repeat-first-pose-frame-to-walk' ||
    transformation === 'repeat-static-idle-to-walk';
  const tiles = [];
  for (let outputRow = 0; outputRow < targetRows; outputRow += 1) {
    const sourceRow = rowStart + outputRow;
    if (sourceRow >= grid.rows) continue;
    for (let outputColumn = 0; outputColumn < targetColumns; outputColumn += 1) {
      const sourceColumn = repeatStatic
        ? firstVisibleColumn(grid, sourceRow, columnStart)
        : columnStart + outputColumn < grid.columns
          ? columnStart + outputColumn
          : null;
      if (sourceColumn === null || grid.occupancy[sourceRow][sourceColumn] === 0) {
        continue;
      }
      let frame = sharp(source.absoluteSourcePath).extract({
        left: sourceColumn * grid.frameSize,
        top: sourceRow * grid.frameSize,
        width: grid.frameSize,
        height: grid.frameSize,
      });
      if (grid.frameSize !== 64) {
        frame = frame.resize(64, 64, { kernel: 'nearest' });
      }
      tiles.push({
        input: await frame.png().toBuffer(),
        left: outputColumn * 64,
        top: outputRow * 64,
      });
    }
  }
  return sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(tiles)
    .png()
    .toBuffer();
}

async function renderGeneratedPng({
  sharp,
  sources,
  outputPath,
  targetAnimation,
  transformation,
  allowTransparent = false,
}) {
  const targetDimensions = {
    idle: { width: 128, height: 256, columns: 2, rows: 4 },
    walk: { width: 576, height: 256, columns: 9, rows: 4 },
    hurt: { width: 832, height: 64, columns: 13, rows: 1 },
  };
  const target = targetDimensions[targetAnimation];
  if (sources.length === 0) {
    if (!allowTransparent) throw new Error(`No sources for ${outputPath}`);
    await sharp({
      create: {
        width: target.width,
        height: target.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png({ compressionLevel: 9, palette: false })
      .toFile(outputPath);
    return;
  }
  const firstSource = sources[0];
  if (
    transformation === 'native-sheet' &&
    sources.length === 1 &&
    firstSource.width === target.width &&
    firstSource.height === target.height
  ) {
    await copyFile(firstSource.absoluteSourcePath, outputPath);
    return;
  }

  const composites = [];
  for (const source of sources) {
    composites.push({
      input: await normalizeSourceToTarget({
        sharp,
        source,
        target,
        targetAnimation,
        transformation,
      }),
      left: 0,
      top: 0,
    });
  }

  await sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);
}

async function generateItems(plan, options) {
  const blocked = plan.items.filter((item) => item.blockingErrors.length > 0);
  if (blocked.length > 0) {
    throw new Error(
      `Generation refused: ${blocked.length} selected item(s) have blocking errors. Review generation-errors.json.`,
    );
  }
  const sharpModule = await import('sharp');
  const sharp = sharpModule.default;
  return mapBounded(plan.items, options.concurrency, async (item) => {
    const startedAt = Date.now();
    const outputDirectory = path.join(options.generatedRoot, item.internalItemId);
    try {
      await mkdir(outputDirectory, { recursive: true });
      for (const animation of ['idle', 'walk', 'hurt']) {
        const selected =
          animation === 'idle'
            ? item.selectedIdleSources
            : animation === 'walk'
              ? item.selectedWalkSources
              : item.selectedHurtSources;
        const fallback = item.fallbackStrategy[animation];
        const sides = item.layered ? ['back', 'front'] : [null];
        for (const side of sides) {
          const filename = side ? `${animation}-${side}.png` : `${animation}.png`;
          const outputPath = path.join(outputDirectory, filename);
          if (!options.force) {
            try {
              await access(outputPath);
              continue;
            } catch {
              // Expected when the output does not exist.
            }
          }
          const sideSources = splitSourcesForSide(selected, side, item.layered);
          await renderGeneratedPng({
            sharp,
            sources: sideSources,
            outputPath,
            targetAnimation: animation,
            transformation: fallback.transformation,
            allowTransparent: item.layered,
          });
        }
      }
      const idleSides = item.layered ? ['back', 'front'] : [null];
      for (const side of idleSides) {
        const sourceName = side ? `idle-${side}.png` : 'idle.png';
        const breatheName = side ? `idle-breathe-${side}.png` : 'idle-breathe.png';
        await copyFile(
          path.join(outputDirectory, sourceName),
          path.join(outputDirectory, breatheName),
        );
      }
      await writeSourceManifest(item, outputDirectory);
      await writeCredits(item, outputDirectory);
      return {
        internalItemId: item.internalItemId,
        success: true,
        outputDirectory,
        durationMs: Date.now() - startedAt,
        error: null,
      };
    } catch (error) {
      return {
        internalItemId: item.internalItemId,
        success: false,
        outputDirectory,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.stack || error.message : String(error),
      };
    }
  });
}

function expectedPngLayout(filename) {
  if (filename.startsWith('walk-') || filename === 'walk.png') {
    return { animation: 'walk', width: 576, height: 256, columns: 9, rows: 4 };
  }
  if (filename.startsWith('hurt-') || filename === 'hurt.png') {
    return { animation: 'hurt', width: 832, height: 64, columns: 13, rows: 1 };
  }
  return {
    animation: filename.startsWith('idle-breathe') ? 'idle-breathe' : 'idle',
    width: 128,
    height: 256,
    columns: 2,
    rows: 4,
  };
}

function animationSourcesForItem(item, animation) {
  if (animation === 'walk') return item.selectedWalkSources || [];
  if (animation === 'hurt') return item.selectedHurtSources || [];
  return item.selectedIdleSources || [];
}

function sourcesForOutputFile(item, filename) {
  const layout = expectedPngLayout(filename);
  const animation = layout.animation === 'idle-breathe' ? 'idle' : layout.animation;
  const sources = animationSourcesForItem(item, animation);
  if (!item.layered) return sources;
  const side = filename.includes('-back') ? 'back' : 'front';
  return splitSourcesForSide(sources, side, true);
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function pngAlphaMetrics(sharp, filePath) {
  const { data, info } = await sharp(filePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let nonTransparentPixels = 0;
  let partialAlphaPixels = 0;
  const channels = info.channels;
  for (let offset = 3; offset < data.length; offset += channels) {
    const alpha = data[offset];
    if (alpha > 0) nonTransparentPixels += 1;
    if (alpha > 0 && alpha < 255) partialAlphaPixels += 1;
  }
  return {
    pixelCount: info.width * info.height,
    nonTransparentPixels,
    transparentPixels: info.width * info.height - nonTransparentPixels,
    partialAlphaPixels,
  };
}

async function selectedSourcesAreEmpty(sharp, sources, cache) {
  if (sources.length === 0) return true;
  const states = await Promise.all(
    sources.map(async (source) => {
      if (!cache.has(source.absoluteSourcePath)) {
        cache.set(
          source.absoluteSourcePath,
          sharp(source.absoluteSourcePath)
            .ensureAlpha()
            .stats()
            .then((stats) => (stats.channels[3]?.max ?? 255) === 0)
            .catch(() => false),
        );
      }
      return cache.get(source.absoluteSourcePath);
    }),
  );
  return states.every(Boolean);
}

function fallbackQualitiesForItem(item) {
  return unique(
    ['idle', 'walk', 'hurt'].map(
      (animation) => item.fallbackStrategy?.[animation]?.quality || 'blocking',
    ),
  );
}

function primaryFallbackQuality(qualities) {
  const severity = [
    'blocking',
    'generic-fallback',
    'same-slot-fallback',
    'same-family-fallback',
    'degraded-static',
    'native',
  ];
  return severity.find((quality) => qualities.includes(quality)) || 'native';
}

async function validateGeneratedAssets(
  plan,
  options,
  generationResults,
  sharp,
) {
  const sourceEmptyCache = new Map();
  const resultByItem = new Map(
    generationResults.map((result) => [result.internalItemId, result]),
  );
  const itemRecords = await mapBounded(
    plan.items,
    Math.min(options.concurrency, 12),
    async (item) => {
      const outputDirectory = path.join(options.generatedRoot, item.internalItemId);
      const generationResult = resultByItem.get(item.internalItemId);
      const expectedFiles = item.layered ? OUTPUT_FILES.layered : OUTPUT_FILES.main;
      const files = [];
      const failures = [];
      const validationWarnings = [];
      for (const filename of expectedFiles) {
        const filePath = path.join(outputDirectory, filename);
        const record = {
          filename,
          relativePath: toProjectRelative(filePath),
          absolutePath: filePath,
          exists: false,
          bytes: 0,
          sha256: null,
          type: filename.endsWith('.png')
            ? 'png'
            : filename.endsWith('.json')
              ? 'manifest'
              : 'credits',
          validation: null,
        };
        try {
          const fileStat = await stat(filePath);
          record.exists = fileStat.isFile();
          record.bytes = fileStat.size;
          record.sha256 = await sha256File(filePath);
          if (!record.exists) failures.push(`${filename}: not a regular file`);
          if (record.type === 'manifest') {
            try {
              JSON.parse(await readFile(filePath, 'utf8'));
              record.validation = { jsonParsed: true };
            } catch (error) {
              record.validation = { jsonParsed: false };
              failures.push(`${filename}: invalid JSON`);
            }
          } else if (record.type === 'credits') {
            record.validation = { present: true };
          } else {
            const expected = expectedPngLayout(filename);
            try {
              const metadata = await sharp(filePath).metadata();
              const alpha = await pngAlphaMetrics(sharp, filePath);
              const selectedSources = sourcesForOutputFile(item, filename);
              const selectedSourcesEmpty = await selectedSourcesAreEmpty(
                sharp,
                selectedSources,
                sourceEmptyCache,
              );
              const dimensionsMatch =
                metadata.width === expected.width && metadata.height === expected.height;
              const gridAligned =
                metadata.width % 64 === 0 &&
                metadata.height % 64 === 0 &&
                metadata.width / 64 === expected.columns &&
                metadata.height / 64 === expected.rows;
              const validPng = metadata.format === 'png';
              const transparencyPreserved =
                Boolean(metadata.hasAlpha) && alpha.transparentPixels > 0;
              const empty = alpha.nonTransparentPixels === 0;
              const intentionallyTransparent =
                selectedSourcesEmpty || (item.layered && empty);
              const nearlyEmpty =
                alpha.nonTransparentPixels > 0 && alpha.nonTransparentPixels < 16;
              record.validation = {
                validPng,
                readableBySharp: true,
                width: metadata.width,
                height: metadata.height,
                expectedWidth: expected.width,
                expectedHeight: expected.height,
                frameSize: 64,
                columns: expected.columns,
                rows: expected.rows,
                dimensionsMatch,
                gridAligned,
                transparencyPreserved,
                nonTransparentPixels: alpha.nonTransparentPixels,
                transparentPixels: alpha.transparentPixels,
                partialAlphaPixels: alpha.partialAlphaPixels,
                empty,
                nearlyEmpty,
                intentionallyTransparent,
              };
              if (!validPng) failures.push(`${filename}: output is not PNG`);
              if (!dimensionsMatch) failures.push(`${filename}: unexpected dimensions`);
              if (!gridAligned) failures.push(`${filename}: invalid 64x64 grid`);
              if (!transparencyPreserved) {
                failures.push(`${filename}: transparency was not preserved`);
              }
              if (empty && !intentionallyTransparent) {
                failures.push(`${filename}: unexpectedly empty`);
              } else if (empty && intentionallyTransparent) {
                validationWarnings.push(
                  `${filename}: intentionally transparent because the approved plan has no non-empty sources for this side.`,
                );
              }
              if (nearlyEmpty) {
                validationWarnings.push(
                  `${filename}: nearly empty (${alpha.nonTransparentPixels} visible pixels).`,
                );
              }
            } catch (error) {
              record.validation = {
                validPng: false,
                readableBySharp: false,
                error: error instanceof Error ? error.message : String(error),
              };
              failures.push(`${filename}: unreadable by sharp`);
            }
          }
        } catch (error) {
          failures.push(`${filename}: missing`);
        }
        files.push(record);
      }

      if (item.layered) {
        for (const animation of ['idle', 'walk', 'hurt', 'idle-breathe']) {
          const back = files.find((file) => file.filename === `${animation}-back.png`);
          const front = files.find((file) => file.filename === `${animation}-front.png`);
          if (
            back?.validation?.width !== front?.validation?.width ||
            back?.validation?.height !== front?.validation?.height
          ) {
            failures.push(`${animation}: front/back dimensions do not match`);
          }
        }
      }
      const fallbackQualities = fallbackQualitiesForItem(item);
      const generatedFiles = files.filter((file) => file.exists);
      return {
        internalItemId: item.internalItemId,
        familyId: item.familyId,
        displayNameAr: item.displayNameAr,
        displayNameEn: item.displayNameEn,
        slot: item.slot,
        rarity: item.rarity,
        variant: item.variant,
        bodyType: item.bodyType,
        lpcVisualId: item.lpcVisualId,
        sourceFamily: item.sourceFamilyPath,
        outputDirectory,
        generatedFiles,
        generatedFileCount: generatedFiles.length,
        outputBytes: sum(generatedFiles.map((file) => file.bytes)),
        strategies: {
          idle: item.fallbackStrategy.idle,
          walk: item.fallbackStrategy.walk,
          hurt: item.fallbackStrategy.hurt,
        },
        fallbackQualities,
        primaryFallbackQuality: primaryFallbackQuality(fallbackQualities),
        sourceFiles: item.selectedSourceFiles.map((source) => ({
          sourceKind: source.sourceKind,
          familyId: source.familyId,
          relativeSourcePath: source.relativeSourcePath,
          absoluteSourcePath: source.absoluteSourcePath,
          layerRole: source.layerRole,
          animation: source.animation,
          sha256: null,
        })),
        credits: item.creditsAndLicenses,
        warnings: [...item.warnings, ...validationWarnings],
        validationFailures: failures,
        generationDurationMs: generationResult?.durationMs ?? null,
        generationSuccess:
          Boolean(generationResult?.success) &&
          failures.length === 0 &&
          generatedFiles.length === expectedFiles.length,
        generationError: generationResult?.error || null,
      };
    },
  );

  const rootEntries = await readdir(options.generatedRoot, { withFileTypes: true });
  const itemDirectories = rootEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('lpc-'))
    .map((entry) => entry.name)
    .sort();
  const catalogIds = plan.items.map((item) => item.internalItemId).sort();
  const missingCatalogItems = catalogIds.filter((id) => !itemDirectories.includes(id));
  const extraItemDirectories = itemDirectories.filter((id) => !catalogIds.includes(id));
  const allGeneratedFiles = itemRecords.flatMap((item) => item.generatedFiles);
  const pathCounts = countBy(allGeneratedFiles, (file) => file.absolutePath);
  const duplicatePaths = Object.entries(pathCounts)
    .filter(([, count]) => count > 1)
    .map(([filePath, count]) => ({ filePath, count }));
  const hashGroups = new Map();
  for (const file of allGeneratedFiles.filter((entry) => entry.sha256)) {
    if (!hashGroups.has(file.sha256)) hashGroups.set(file.sha256, []);
    hashGroups.get(file.sha256).push(file.relativePath);
  }
  const duplicateHashes = [...hashGroups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([sha256, paths]) => ({
      sha256,
      fileCount: paths.length,
      totalBytes: sum(
        allGeneratedFiles
          .filter((file) => file.sha256 === sha256)
          .map((file) => file.bytes),
      ),
      paths: paths.sort(),
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);
  const pngFiles = allGeneratedFiles.filter((file) => file.type === 'png');
  const invalidPngs = pngFiles.filter(
    (file) =>
      !file.validation?.validPng ||
      !file.validation?.readableBySharp ||
      !file.validation?.dimensionsMatch ||
      !file.validation?.gridAligned ||
      !file.validation?.transparencyPreserved,
  );
  const accidentallyEmptyPngs = pngFiles.filter(
    (file) =>
      file.validation?.empty && !file.validation?.intentionallyTransparent,
  );
  const intentionallyTransparentPngs = pngFiles.filter(
    (file) =>
      file.validation?.empty && file.validation?.intentionallyTransparent,
  );
  const nearlyEmptyPngs = pngFiles.filter((file) => file.validation?.nearlyEmpty);
  const successfulItems = itemRecords.filter((item) => item.generationSuccess);
  const failedItems = itemRecords.filter((item) => !item.generationSuccess);
  return {
    itemRecords,
    duplicateHashes,
    validation: {
      expectedItemDirectoryCount: plan.items.length,
      actualItemDirectoryCount: itemDirectories.length,
      uniqueVisualIdCount: new Set(
        itemRecords.map((item) => item.lpcVisualId),
      ).size,
      duplicateInternalIds:
        itemRecords.length -
        new Set(itemRecords.map((item) => item.internalItemId)).size,
      missingCatalogItems,
      extraItemDirectories,
      duplicateOutputPaths: duplicatePaths,
      requiredGeneratedFileCount: sum(
        plan.items.map((item) =>
          item.layered ? OUTPUT_FILES.layered.length : OUTPUT_FILES.main.length,
        ),
      ),
      actualGeneratedItemFileCount: allGeneratedFiles.length,
      pngCount: pngFiles.length,
      invalidPngCount: invalidPngs.length,
      invalidPngs: invalidPngs.map((file) => file.relativePath),
      accidentallyEmptyPngCount: accidentallyEmptyPngs.length,
      accidentallyEmptyPngs: accidentallyEmptyPngs.map(
        (file) => file.relativePath,
      ),
      intentionallyTransparentPngCount: intentionallyTransparentPngs.length,
      intentionallyTransparentPngs: intentionallyTransparentPngs.map(
        (file) => file.relativePath,
      ),
      nearlyEmptyPngCount: nearlyEmptyPngs.length,
      nearlyEmptyPngs: nearlyEmptyPngs.map((file) => file.relativePath),
      successfulItemCount: successfulItems.length,
      failedItemCount: failedItems.length,
      allChecksPassed:
        itemDirectories.length === plan.items.length &&
        missingCatalogItems.length === 0 &&
        extraItemDirectories.length === 0 &&
        duplicatePaths.length === 0 &&
        invalidPngs.length === 0 &&
        accidentallyEmptyPngs.length === 0 &&
        failedItems.length === 0 &&
        allGeneratedFiles.length ===
          sum(
            plan.items.map((item) =>
              item.layered
                ? OUTPUT_FILES.layered.length
                : OUTPUT_FILES.main.length,
            ),
          ),
    },
  };
}

function generationCsvRows(itemRecords) {
  return itemRecords.map((item) => ({
    internalItemId: item.internalItemId,
    familyId: item.familyId,
    displayNameAr: item.displayNameAr,
    displayNameEn: item.displayNameEn,
    slot: item.slot,
    rarity: item.rarity,
    variant: item.variant,
    bodyType: item.bodyType,
    lpcVisualId: item.lpcVisualId,
    outputDirectory: item.outputDirectory,
    generatedFileCount: item.generatedFileCount,
    outputBytes: item.outputBytes,
    idleQuality: item.strategies.idle.quality,
    idleStrategy: item.strategies.idle.strategy,
    walkQuality: item.strategies.walk.quality,
    walkStrategy: item.strategies.walk.strategy,
    hurtQuality: item.strategies.hurt.quality,
    hurtStrategy: item.strategies.hurt.strategy,
    fallbackQualities: item.fallbackQualities,
    sourceFiles: item.sourceFiles.map((source) => source.absoluteSourcePath),
    warnings: item.warnings,
    generatedFiles: item.generatedFiles.map((file) => file.relativePath),
    fileSha256: Object.fromEntries(
      item.generatedFiles.map((file) => [file.filename, file.sha256]),
    ),
    generationSuccess: item.generationSuccess,
    generationError: item.generationError,
    validationFailures: item.validationFailures,
  }));
}

function aggregateGeneratedBytes(itemRecords, field) {
  return Object.fromEntries(
    [...new Set(itemRecords.map((item) => item[field]))]
      .sort()
      .map((value) => [
        value,
        {
          itemCount: itemRecords.filter((item) => item[field] === value).length,
          bytes: sum(
            itemRecords
              .filter((item) => item[field] === value)
              .map((item) => item.outputBytes),
          ),
        },
      ]),
  );
}

async function extractComposedFrame(sharp, item, generatedRoot, state, row, column) {
  const baseState = state === 'idle-breathe' ? 'idle-breathe' : state;
  const filenames = item.layered
    ? [`${baseState}-back.png`, `${baseState}-front.png`]
    : [`${baseState}.png`];
  const inputs = [];
  for (const filename of filenames) {
    const inputPath = path.join(generatedRoot, item.internalItemId, filename);
    try {
      const metadata = await sharp(inputPath).metadata();
      const left = Math.min(column * 64, Math.max(0, (metadata.width || 64) - 64));
      const top = Math.min(row * 64, Math.max(0, (metadata.height || 64) - 64));
      inputs.push(
        await sharp(inputPath)
          .extract({ left, top, width: 64, height: 64 })
          .png()
          .toBuffer(),
      );
    } catch {
      // Missing failed output is represented by the empty base canvas.
    }
  }
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(inputs.map((input) => ({ input, left: 0, top: 0 })))
    .png()
    .toBuffer();
}

async function createReviewThumbnail(sharp, item, generatedRoot, outputPath) {
  const frameSpecs = [
    { state: 'idle', row: 2, column: 0 },
    { state: 'walk', row: 1, column: 4 },
    { state: 'hurt', row: 0, column: 5 },
    { state: 'idle-breathe', row: 2, column: 0 },
    { state: 'idle-breathe', row: 2, column: 1 },
  ];
  const frames = await Promise.all(
    frameSpecs.map((spec) =>
      extractComposedFrame(
        sharp,
        item,
        generatedRoot,
        spec.state,
        spec.row,
        spec.column,
      ),
    ),
  );
  const scaled = await Promise.all(
    frames.map((frame) =>
      sharp(frame)
        .resize(128, 128, { kernel: 'nearest' })
        .png()
        .toBuffer(),
    ),
  );
  await sharp({
    create: {
      width: 640,
      height: 128,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite(
      scaled.map((input, index) => ({
        input,
        left: index * 128,
        top: 0,
      })),
    )
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function createContactSheet(sharp, title, records, thumbnailsDirectory, outputPath) {
  const columns = 5;
  const cellWidth = 320;
  const cellHeight = 96;
  const headerHeight = 52;
  const rows = Math.max(1, Math.ceil(records.length / columns));
  const composites = [
    {
      input: Buffer.from(
        `<svg width="${columns * cellWidth}" height="${headerHeight}">
          <rect width="100%" height="100%" fill="#0f172a"/>
          <text x="18" y="34" font-family="Arial, sans-serif" font-size="22" fill="#f8fafc">${xmlEscape(title)} (${records.length})</text>
        </svg>`,
      ),
      left: 0,
      top: 0,
    },
  ];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * cellWidth;
    const top = headerHeight + row * cellHeight;
    const thumbnailPath = path.join(
      thumbnailsDirectory,
      `${record.internalItemId}.png`,
    );
    const thumbnail = await sharp(thumbnailPath)
      .resize(320, 64, { kernel: 'nearest', fit: 'fill' })
      .png()
      .toBuffer();
    composites.push({ input: thumbnail, left, top });
    composites.push({
      input: Buffer.from(
        `<svg width="${cellWidth}" height="32">
          <rect width="100%" height="100%" fill="#1e293b"/>
          <text x="6" y="14" font-family="Arial, sans-serif" font-size="10" fill="#f8fafc">${xmlEscape(record.internalItemId.slice(0, 48))}</text>
          <text x="6" y="27" font-family="Arial, sans-serif" font-size="9" fill="#94a3b8">${xmlEscape(`${record.slot} · ${record.rarity} · ${record.primaryFallbackQuality}`)}</text>
        </svg>`,
      ),
      left,
      top: top + 64,
    });
  }
  await sharp({
    create: {
      width: columns * cellWidth,
      height: headerHeight + rows * cellHeight,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, palette: false })
    .toFile(outputPath);
}

function balancedSample(itemRecords) {
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const result = [];
  for (const slot of ['weapon', 'helmet', 'armor', 'boots']) {
    const selected = [];
    for (const rarity of rarities) {
      selected.push(
        ...itemRecords
          .filter((item) => item.slot === slot && item.rarity === rarity)
          .slice(0, 2),
      );
    }
    if (selected.length < 10) {
      const used = new Set(selected.map((item) => item.internalItemId));
      selected.push(
        ...itemRecords
          .filter((item) => item.slot === slot && !used.has(item.internalItemId))
          .slice(0, 10 - selected.length),
      );
    }
    result.push(...selected.slice(0, 10));
  }
  return result;
}

function renderGalleryHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>LPC generated dungeon-loot review</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,Arial,sans-serif;background:#020617;color:#e2e8f0}
    *{box-sizing:border-box}body{margin:0;padding:20px}.shell{max-width:1600px;margin:auto}
    h1{margin:0 0 6px}.summary{color:#94a3b8;margin-bottom:16px}.filters{position:sticky;top:0;z-index:5;background:#020617ee;
    backdrop-filter:blur(8px);display:grid;grid-template-columns:2fr repeat(5,minmax(130px,1fr));gap:10px;padding:12px 0}
    input,select,button{border:1px solid #334155;background:#0f172a;color:#f8fafc;border-radius:7px;padding:9px}
    button{cursor:pointer}.quick{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px}.quick button{font-size:12px}
    #cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:12px}.card{background:#0f172a;border:1px solid #1e293b;
    border-radius:10px;overflow:hidden}.card img{display:block;width:100%;height:auto;image-rendering:pixelated;image-rendering:crisp-edges;background:#111827}
    .meta{padding:10px}.id{font:11px ui-monospace,monospace;color:#93c5fd;overflow-wrap:anywhere}.names{display:flex;justify-content:space-between;gap:12px;margin:7px 0}
    .badges{display:flex;flex-wrap:wrap;gap:5px}.badge{font-size:11px;background:#1e293b;border-radius:999px;padding:3px 7px}.warn{color:#fbbf24;font-size:11px;margin-top:7px}
    #loadMore{display:block;margin:22px auto;min-width:180px}.hidden{display:none}
  </style>
</head>
<body><main class="shell">
  <h1>Generated LPC dungeon-loot review</h1>
  <div class="summary" id="summary"></div>
  <section class="filters">
    <input id="search" placeholder="Search ID, Arabic/English name, family">
    <select id="slot"><option value="">All slots</option></select>
    <select id="rarity"><option value="">All rarities</option></select>
    <select id="quality"><option value="">All fallback qualities</option></select>
    <select id="native"><option value="">Native + fallback</option><option value="native">Native only</option><option value="fallback">Uses fallback</option></select>
    <select id="warnings"><option value="">Warnings: any</option><option value="yes">Has warnings</option><option value="no">No warnings</option></select>
  </section>
  <div class="quick">
    <button data-quality="degraded-static">Show only degraded-static</button>
    <button data-quality="same-slot-fallback">Show only same-slot fallback</button>
    <button data-quality="generic-fallback">Show only generic fallback</button>
    <button data-warning="yes">Show items with warnings</button>
    <button data-all="true">Show all</button>
  </div>
  <section id="cards"></section>
  <button id="loadMore">Load more</button>
</main>
<script src="gallery-data.js"></script>
<script>
(() => {
  const all = window.LPC_GALLERY_DATA.items;
  const els = Object.fromEntries(['search','slot','rarity','quality','native','warnings','cards','loadMore','summary'].map(id=>[id,document.getElementById(id)]));
  const unique = key => [...new Set(all.flatMap(item => Array.isArray(item[key]) ? item[key] : [item[key]]).filter(Boolean))].sort();
  for (const [id,key] of [['slot','slot'],['rarity','rarity'],['quality','fallbackQualities']]) {
    for (const value of unique(key)) { const option=document.createElement('option');option.value=value;option.textContent=value;els[id].append(option); }
  }
  let shown=50,filtered=[];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function apply() {
    const q=els.search.value.trim().toLowerCase();
    filtered=all.filter(item => {
      const hay=[item.internalItemId,item.displayNameAr,item.displayNameEn,item.familyId].join(' ').toLowerCase();
      return (!q||hay.includes(q))&&(!els.slot.value||item.slot===els.slot.value)&&(!els.rarity.value||item.rarity===els.rarity.value)&&
        (!els.quality.value||item.fallbackQualities.includes(els.quality.value))&&(!els.native.value||(els.native.value==='native'?item.nativeOnly:!item.nativeOnly))&&
        (!els.warnings.value||(els.warnings.value==='yes'?item.warningCount>0:item.warningCount===0));
    });
    shown=50;render();
  }
  function render() {
    els.cards.innerHTML=filtered.slice(0,shown).map(item=>\`<article class="card">
      <img src="\${esc(item.thumbnail)}" width="640" height="128" alt="">
      <div class="meta"><div class="id">\${esc(item.internalItemId)}</div><div class="names"><strong>\${esc(item.displayNameEn)}</strong><span dir="rtl">\${esc(item.displayNameAr)}</span></div>
      <div class="badges"><span class="badge">\${esc(item.slot)}</span><span class="badge">\${esc(item.rarity)}</span><span class="badge">\${esc(item.primaryFallbackQuality)}</span>
      <span class="badge">\${item.generatedFileCount} files</span><span class="badge">\${item.outputBytes.toLocaleString()} B</span><span class="badge">variant: \${esc(item.variant||'default')}</span></div>
      <div class="id">family: \${esc(item.familyId)}</div>\${item.warningCount?\`<div class="warn">\${item.warningCount} warning(s)</div>\`:''}</div></article>\`).join('');
    els.summary.textContent=\`Showing \${Math.min(shown,filtered.length)} of \${filtered.length} filtered items · \${all.length} generated items\`;
    els.loadMore.classList.toggle('hidden',shown>=filtered.length);
  }
  for (const id of ['search','slot','rarity','quality','native','warnings']) els[id].addEventListener(id==='search'?'input':'change',apply);
  els.loadMore.addEventListener('click',()=>{shown+=50;render()});
  document.querySelectorAll('[data-quality]').forEach(button=>button.addEventListener('click',()=>{els.quality.value=button.dataset.quality;apply()}));
  document.querySelector('[data-warning]').addEventListener('click',()=>{els.warnings.value='yes';apply()});
  document.querySelector('[data-all]').addEventListener('click',()=>{for(const id of ['search','slot','rarity','quality','native','warnings'])els[id].value='';apply()});
  apply();
})();
</script></body></html>`;
}

async function createReviewArtifacts(plan, validationResult, options, sharp) {
  const reviewDirectory = path.join(options.generatedRoot, 'review');
  const galleryDirectory = path.join(options.generatedRoot, 'review-gallery');
  const thumbnailsDirectory = path.join(galleryDirectory, 'thumbnails');
  const contactDirectory = path.join(
    options.generatedRoot,
    'review-contact-sheets',
  );
  await Promise.all([
    mkdir(reviewDirectory, { recursive: true }),
    mkdir(thumbnailsDirectory, { recursive: true }),
    mkdir(contactDirectory, { recursive: true }),
  ]);
  const itemById = new Map(plan.items.map((item) => [item.internalItemId, item]));
  await mapBounded(
    validationResult.itemRecords,
    Math.min(options.concurrency, 10),
    async (record) => {
      const item = itemById.get(record.internalItemId);
      await createReviewThumbnail(
        sharp,
        item,
        options.generatedRoot,
        path.join(thumbnailsDirectory, `${record.internalItemId}.png`),
      );
    },
  );

  const categoryRecords = {
    'native-items.json': validationResult.itemRecords.filter(
      (item) => item.fallbackQualities.length === 1 && item.fallbackQualities[0] === 'native',
    ),
    'degraded-static-items.json': validationResult.itemRecords.filter((item) =>
      item.fallbackQualities.includes('degraded-static'),
    ),
    'same-family-fallback-items.json': validationResult.itemRecords.filter((item) =>
      item.fallbackQualities.includes('same-family-fallback'),
    ),
    'same-slot-fallback-items.json': validationResult.itemRecords.filter((item) =>
      item.fallbackQualities.includes('same-slot-fallback'),
    ),
    'generic-fallback-items.json': validationResult.itemRecords.filter((item) =>
      item.fallbackQualities.includes('generic-fallback'),
    ),
  };
  await Promise.all(
    Object.entries(categoryRecords).map(([filename, records]) =>
      writeFile(
        path.join(reviewDirectory, filename),
        `${JSON.stringify(
          records.map((item) => ({
            internalItemId: item.internalItemId,
            familyId: item.familyId,
            slot: item.slot,
            rarity: item.rarity,
            lpcVisualId: item.lpcVisualId,
            fallbackQualities: item.fallbackQualities,
            strategies: item.strategies,
            selectedFallbackAssets: item.sourceFiles
              .filter((source) => source.sourceKind === 'existing-generic-production-lpc')
              .map((source) => source.absoluteSourcePath),
            reason: Object.fromEntries(
              Object.entries(item.strategies)
                .filter(([, strategy]) => strategy.quality !== 'native')
                .map(([animation, strategy]) => [animation, strategy.strategy]),
            ),
            sourceFamily: item.sourceFamily,
            expectedVisualMismatch: item.fallbackQualities.includes('generic-fallback')
              ? 'Generic slot artwork is compatible but is not visually identical to the selected family.'
              : null,
          })),
          null,
          2,
        )}\n`,
        'utf8',
      ),
    ),
  );

  const galleryItems = validationResult.itemRecords.map((item) => ({
    internalItemId: item.internalItemId,
    familyId: item.familyId,
    displayNameAr: item.displayNameAr,
    displayNameEn: item.displayNameEn,
    slot: item.slot,
    rarity: item.rarity,
    variant: item.variant,
    fallbackQualities: item.fallbackQualities,
    primaryFallbackQuality: item.primaryFallbackQuality,
    nativeOnly:
      item.fallbackQualities.length === 1 && item.fallbackQualities[0] === 'native',
    warningCount: item.warnings.length,
    generatedFileCount: item.generatedFileCount,
    outputBytes: item.outputBytes,
    thumbnail: `thumbnails/${item.internalItemId}.png`,
  }));
  await Promise.all([
    writeFile(path.join(galleryDirectory, 'index.html'), renderGalleryHtml(), 'utf8'),
    writeFile(
      path.join(galleryDirectory, 'gallery-data.js'),
      `window.LPC_GALLERY_DATA = ${JSON.stringify({ items: galleryItems })};\n`,
      'utf8',
    ),
    writeFile(
      path.join(galleryDirectory, 'summary.md'),
      [
        '# Generated LPC review gallery',
        '',
        `- Items: ${galleryItems.length}`,
        `- Thumbnails: ${galleryItems.length}`,
        '- Frames per thumbnail: idle front, walk left, hurt final, breathing rest, breathing inhale',
        '- Rendering: nearest-neighbor at 2x',
        '- Runtime: static file://; no fetch()',
        '',
      ].join('\n'),
      'utf8',
    ),
  ]);

  const generic = categoryRecords['generic-fallback-items.json'];
  const degraded = categoryRecords['degraded-static-items.json'].slice(0, 30);
  const sameSlot = categoryRecords['same-slot-fallback-items.json'].slice(0, 30);
  const largest = [...validationResult.itemRecords]
    .sort((a, b) => b.outputBytes - a.outputBytes)
    .slice(0, 20);
  const balanced = balancedSample(validationResult.itemRecords);
  const sheetDefinitions = [
    ['generic-fallback-items.png', 'All generic fallback items', generic],
    ['degraded-static-first-30.png', 'First 30 degraded-static items', degraded],
    ['same-slot-fallback-first-30.png', 'First 30 same-slot fallback items', sameSlot],
    ['largest-20-items.png', 'Largest 20 generated items', largest],
    ['balanced-slot-rarity-sample.png', 'Balanced slot and rarity sample', balanced],
  ];
  await mapBounded(sheetDefinitions, 2, async ([filename, title, records]) =>
    createContactSheet(
      sharp,
      title,
      records,
      thumbnailsDirectory,
      path.join(contactDirectory, filename),
    ),
  );
  return {
    reviewDirectory,
    galleryDirectory,
    thumbnailsDirectory,
    thumbnailCount: galleryItems.length,
    contactSheets: sheetDefinitions.map(([filename]) =>
      path.join(contactDirectory, filename),
    ),
    categories: Object.fromEntries(
      Object.entries(categoryRecords).map(([filename, records]) => [
        filename,
        records.length,
      ]),
    ),
  };
}

async function writeGenerationReports(
  plan,
  validationResult,
  reviewArtifacts,
  options,
  timing,
  approvedPlanVerification,
) {
  const records = validationResult.itemRecords;
  const allFiles = records.flatMap((item) => item.generatedFiles);
  const actualBytes = sum(records.map((item) => item.outputBytes));
  const estimatedBytes = plan.summary.estimatedOutputBytes;
  const bytesByFallbackQuality = Object.fromEntries(
    [
      'native',
      'degraded-static',
      'same-family-fallback',
      'same-slot-fallback',
      'generic-fallback',
      'blocking',
    ].map((quality) => [
      quality,
      {
        itemCount: records.filter(
          (item) => item.primaryFallbackQuality === quality,
        ).length,
        bytes: sum(
          records
            .filter((item) => item.primaryFallbackQuality === quality)
            .map((item) => item.outputBytes),
        ),
      },
    ]),
  );
  const largest20 = [...records]
    .sort((a, b) => b.outputBytes - a.outputBytes)
    .slice(0, 20)
    .map((item) => ({
      internalItemId: item.internalItemId,
      slot: item.slot,
      rarity: item.rarity,
      outputBytes: item.outputBytes,
      generatedFileCount: item.generatedFileCount,
    }));
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'generate',
    outputRoot: options.generatedRoot,
    approvedPlan: {
      path: options.approvedPlan,
      ...approvedPlanVerification,
    },
    generationDurationMs: timing.generationDurationMs,
    validationDurationMs: timing.validationDurationMs,
    reviewDurationMs: timing.reviewDurationMs,
    totalDurationMs: timing.totalDurationMs,
    summary: {
      generatedItemDirectoryCount:
        validationResult.validation.actualItemDirectoryCount,
      generatedItemFileCount: allFiles.length,
      actualGeneratedBytes: actualBytes,
      estimatedBytes,
      estimateDifferenceBytes: actualBytes - estimatedBytes,
      estimateRatio:
        estimatedBytes > 0 ? Number((actualBytes / estimatedBytes).toFixed(4)) : null,
      successfulItemCount: validationResult.validation.successfulItemCount,
      failedItemCount: validationResult.validation.failedItemCount,
      fallbackAnimationCounts: plan.summary.fallbackCountsByQuality,
      fallbackItemCounts: reviewArtifacts.categories,
      invalidPngCount: validationResult.validation.invalidPngCount,
      accidentallyEmptyPngCount:
        validationResult.validation.accidentallyEmptyPngCount,
      intentionallyTransparentPngCount:
        validationResult.validation.intentionallyTransparentPngCount,
      nearlyEmptyPngCount: validationResult.validation.nearlyEmptyPngCount,
      duplicateHashGroupCount: validationResult.duplicateHashes.length,
      bytesBySlot: aggregateGeneratedBytes(records, 'slot'),
      bytesByRarity: aggregateGeneratedBytes(records, 'rarity'),
      bytesByFallbackQuality,
      largest20Items: largest20,
    },
    validation: validationResult.validation,
    duplicateFileHashes: validationResult.duplicateHashes,
    reviewArtifacts,
    items: records,
  };
  const failures = {
    generatedAt: manifest.generatedAt,
    failedItemCount: manifest.summary.failedItemCount,
    invalidPngCount: manifest.summary.invalidPngCount,
    accidentallyEmptyPngCount: manifest.summary.accidentallyEmptyPngCount,
    items: records
      .filter((item) => !item.generationSuccess)
      .map((item) => ({
        internalItemId: item.internalItemId,
        generationError: item.generationError,
        validationFailures: item.validationFailures,
      })),
  };
  const genericItems = records.filter((item) =>
    item.fallbackQualities.includes('generic-fallback'),
  );
  const resultMarkdown = [
    '# LPC generated staging result',
    '',
    `Generated: ${manifest.generatedAt}`,
    `Output: ${options.generatedRoot}`,
    `Approved plan: ${options.approvedPlan}`,
    '',
    '## Result',
    '',
    `- Duration: ${(timing.totalDurationMs / 1000).toFixed(2)} seconds`,
    `- Item directories: ${manifest.summary.generatedItemDirectoryCount}`,
    `- Item files: ${manifest.summary.generatedItemFileCount}`,
    `- Actual item bytes: ${manifest.summary.actualGeneratedBytes}`,
    `- Estimated bytes: ${manifest.summary.estimatedBytes}`,
    `- Successful items: ${manifest.summary.successfulItemCount}`,
    `- Failed items: ${manifest.summary.failedItemCount}`,
    `- Invalid PNGs: ${manifest.summary.invalidPngCount}`,
    `- Accidentally empty PNGs: ${manifest.summary.accidentallyEmptyPngCount}`,
    `- Intentionally transparent PNGs: ${manifest.summary.intentionallyTransparentPngCount}`,
    `- Duplicate hash groups: ${manifest.summary.duplicateHashGroupCount}`,
    '',
    '## Generic fallback items',
    '',
    ...genericItems.flatMap((item) => [
      `### ${item.internalItemId}`,
      '',
      `- Slot: ${item.slot}`,
      `- Source family: ${item.sourceFamily}`,
      `- Fallback assets: ${item.sourceFiles
        .filter((source) => source.sourceKind === 'existing-generic-production-lpc')
        .map((source) => source.relativeSourcePath)
        .join(', ')}`,
      '- Expected mismatch: generic slot artwork is compatible but not visually identical to the selected family.',
      '',
    ]),
    '## Review',
    '',
    `- Gallery: ${reviewArtifacts.galleryDirectory}`,
    ...reviewArtifacts.contactSheets.map((sheet) => `- Contact sheet: ${sheet}`),
    '',
  ].join('\n');
  const csvRows = generationCsvRows(records);
  await Promise.all([
    writeFile(
      path.join(options.generatedRoot, 'generated-assets-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      path.join(options.generatedRoot, 'generated-assets-manifest.csv'),
      renderCsv(csvRows, Object.keys(csvRows[0] || {})),
      'utf8',
    ),
    writeFile(
      path.join(options.generatedRoot, 'generation-result.md'),
      resultMarkdown,
      'utf8',
    ),
    writeFile(
      path.join(options.generatedRoot, 'generation-failures.json'),
      `${JSON.stringify(failures, null, 2)}\n`,
      'utf8',
    ),
  ]);
  return manifest;
}

async function main() {
  const totalStartedAt = Date.now();
  const options = parseArguments(process.argv.slice(2));
  const [catalog, familyIndex, fileIndex, curatedIndex] = await Promise.all([
    readJson(options.catalog),
    readJson(options.index),
    readJson(options.filesIndex),
    readJson(options.curated),
  ]);
  const sourceRoot = path.resolve(
    options.source || familyIndex.sourceRoot || fileIndex.sourceRoot,
  );
  const allItems = Array.isArray(catalog.items) ? catalog.items : [];
  const families = Array.isArray(familyIndex.families) ? familyIndex.families : [];
  const familyById = new Map(families.map((family) => [family.familyId, family]));
  const fileMetadataByPath = new Map(
    (fileIndex.files || []).map((file) => [
      normalizeRelative(file.relativeSourcePath),
      file,
    ]),
  );
  const curatedFamilyIds = new Set(
    (curatedIndex.families || []).map((family) => family.familyId),
  );
  const idCounts = countBy(allItems, (item) => item.internalItemId);
  const duplicateIds = new Set(
    Object.entries(idCounts)
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  );
  let selectedItems = allItems;
  if (options.item) {
    selectedItems = selectedItems.filter(
      (item) => item.internalItemId === options.item,
    );
  }
  if (options.slot) {
    selectedItems = selectedItems.filter((item) => item.slot === options.slot);
  }
  if (options.rarity) {
    selectedItems = selectedItems.filter((item) => item.rarity === options.rarity);
  }
  if (selectedItems.length === 0) {
    throw new Error('No catalog items match the selected filters.');
  }

  const items = selectedItems.map((item) =>
    createItemPlan({
      item,
      family: familyById.get(item.familyId),
      families,
      familyById,
      fileMetadataByPath,
      sourceRoot,
      generatedRoot: options.generatedRoot,
      duplicateIds,
      curatedFamilyIds,
    }),
  );
  const pathValidation = await hydrateSourcePathState(items, options.concurrency);
  const { uniqueVisualAssets, itemToVisualMapping } = buildVisualSharing(
    items,
    options.generatedRoot,
  );
  const summary = summarizePlan(
    items,
    uniqueVisualAssets,
    allItems.length,
    pathValidation,
  );
  const filtersActive = Boolean(options.item || options.slot || options.rarity);
  const validation = validatePlan({
    items,
    summary,
    filtersActive,
    expectedFullCount: catalog.totalItems || 682,
    itemToVisualMapping,
  });
  const plan = {
    schemaVersion: 1,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    inputs: {
      catalog: options.catalog,
      assetFamilyIndex: options.index,
      libraryFileIndex: options.filesIndex,
      curatedFamilyIndex: options.curated,
      sourceRoot,
      generatedAssetRoot: options.generatedRoot,
    },
    filters: {
      item: options.item,
      slot: options.slot,
      rarity: options.rarity,
    },
    concurrency: options.concurrency,
    summary,
    validation,
    uniqueVisualAssets,
    itemToVisualMapping,
    items,
  };

  let generationManifest = null;
  if (options.mode === 'plan-only') {
    await writePlanReports(plan, options.out);
  } else {
    if (!validation.passed) {
      throw new Error(
        'Generation refused because the selected plan failed validation.',
      );
    }
    const approvedPlan = await readJson(options.approvedPlan);
    const approvedPlanVerification = verifyApprovedPlan(items, approvedPlan);
    await mkdir(options.generatedRoot, { recursive: true });
    const generationStartedAt = Date.now();
    const generationResults = await generateItems(plan, options);
    const generationFinishedAt = Date.now();
    const sharpModule = await import('sharp');
    const sharp = sharpModule.default;
    const validationStartedAt = Date.now();
    const generatedValidation = await validateGeneratedAssets(
      plan,
      options,
      generationResults,
      sharp,
    );
    const validationFinishedAt = Date.now();
    const reviewStartedAt = Date.now();
    const reviewArtifacts = await createReviewArtifacts(
      plan,
      generatedValidation,
      options,
      sharp,
    );
    const reviewFinishedAt = Date.now();
    generationManifest = await writeGenerationReports(
      plan,
      generatedValidation,
      reviewArtifacts,
      options,
      {
        generationDurationMs: generationFinishedAt - generationStartedAt,
        validationDurationMs: validationFinishedAt - validationStartedAt,
        reviewDurationMs: reviewFinishedAt - reviewStartedAt,
        totalDurationMs: reviewFinishedAt - totalStartedAt,
      },
      approvedPlanVerification,
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: options.mode,
        reportDirectory: options.out,
        plannedItems: summary.plannedItemCount,
        uniqueVisualAssets: summary.uniqueVisualAssetCount,
        plannedOutputFiles: summary.plannedOutputFileCount,
        estimatedOutputBytes: summary.estimatedOutputBytes,
        blockingErrors: summary.blockingErrorCount,
        warnings: summary.warningCount,
        validationPassed: validation.passed,
        generatedItems:
          generationManifest?.summary.generatedItemDirectoryCount ?? null,
        generatedFiles:
          generationManifest?.summary.generatedItemFileCount ?? null,
        actualGeneratedBytes:
          generationManifest?.summary.actualGeneratedBytes ?? null,
        successfulItems:
          generationManifest?.summary.successfulItemCount ?? null,
        failedItems: generationManifest?.summary.failedItemCount ?? null,
        invalidPngs: generationManifest?.summary.invalidPngCount ?? null,
        accidentallyEmptyPngs:
          generationManifest?.summary.accidentallyEmptyPngCount ?? null,
      },
      null,
      2,
    )}\n`,
  );
  if (
    !validation.passed ||
    summary.blockingErrorCount > 0 ||
    (generationManifest &&
      (!generationManifest.validation.allChecksPassed ||
        generationManifest.summary.failedItemCount > 0))
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
