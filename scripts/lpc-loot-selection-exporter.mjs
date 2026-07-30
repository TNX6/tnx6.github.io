import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION = 'lpc-loot-selection-v1';
const SLOT_VALUES = Object.freeze(['weapon', 'helmet', 'armor', 'boots']);
const RARITY_VALUES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const BODY_VALUES = Object.freeze(['male', 'universal', 'adult']);
const ITEM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArguments(argv) {
  const options = {
    input: null,
    out: '.temp/lpc-loot-selection',
    index: '.temp/lpc-library-index/asset-families.json',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--input', '--out', '--index'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--input') options.input = value;
    if (argument === '--out') options.out = value;
    if (argument === '--index') options.index = value;
  }
  if (!options.input) throw new Error('Missing required option: --input');
  return options;
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function asString(value, label, errors, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string`);
    return '';
  }
  if (!allowEmpty && value.length === 0) errors.push(`${label} must not be empty`);
  return value;
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function preferredBodyType(family, requestedBodyType) {
  if (BODY_VALUES.includes(requestedBodyType) && family.availableBodyTypes.includes(requestedBodyType)) {
    return requestedBodyType;
  }
  return BODY_VALUES.find((bodyType) => family.availableBodyTypes.includes(bodyType)) ?? 'male';
}

function authoritativeWarnings(item, family) {
  const warnings = [];
  if (family.compatibility !== 'compatible') warnings.push(`technical compatibility: ${family.compatibility}`);
  warnings.push(...family.compatibilityWarnings);
  if (['cosmetic-only', 'unsuitable', 'uncertain'].includes(family.dungeonSuitability)) {
    warnings.push(`dungeon suitability: ${family.dungeonSuitability}`);
  }
  if (family.availableVariants.length === 0 || !item.variant) warnings.push('no selected indexed variant');
  if (!item.displayNameAr.trim()) warnings.push('missing Arabic display name');
  if (!item.displayNameEn.trim()) warnings.push('missing English display name');
  if (!family.availableBodyTypes.some((bodyType) => BODY_VALUES.includes(bodyType))) {
    warnings.push('no confirmed male/universal/adult source support; male is the requested dungeon target');
  }
  if (!family.authors?.length || !family.licenses?.length) warnings.push('uncertain credits metadata');
  return sortedUnique(warnings);
}

function validateAndNormalize(payload, families) {
  assertPlainObject(payload, 'Selection');
  if (payload.version !== VERSION) {
    throw new Error(`Selection version must be ${VERSION}`);
  }
  if (!Array.isArray(payload.items)) throw new Error('Selection items must be an array');

  const familyById = new Map(families.map((family) => [family.familyId, family]));
  const errors = [];
  const normalized = [];
  const itemIdCounts = new Map();

  payload.items.forEach((rawItem, itemIndex) => {
    const label = `items[${itemIndex}]`;
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      errors.push(`${label} must be an object`);
      return;
    }
    const itemId = asString(rawItem.itemId, `${label}.itemId`, errors, { allowEmpty: false });
    const familyId = asString(rawItem.familyId, `${label}.familyId`, errors, { allowEmpty: false });
    const slot = asString(rawItem.slot, `${label}.slot`, errors, { allowEmpty: false });
    const rarity = asString(rawItem.rarity, `${label}.rarity`, errors, { allowEmpty: false });
    const variant = asString(rawItem.variant ?? '', `${label}.variant`, errors);
    const displayNameAr = asString(rawItem.displayNameAr ?? '', `${label}.displayNameAr`, errors);
    const displayNameEn = asString(rawItem.displayNameEn ?? '', `${label}.displayNameEn`, errors);
    const notes = asString(rawItem.notes ?? '', `${label}.notes`, errors);

    if (itemId && !ITEM_ID_PATTERN.test(itemId)) {
      errors.push(`${label}.itemId must use lowercase letters, numbers, and single hyphens only`);
    }
    if (itemId) itemIdCounts.set(itemId, (itemIdCounts.get(itemId) ?? 0) + 1);
    if (!SLOT_VALUES.includes(slot)) errors.push(`${label}.slot must be one of: ${SLOT_VALUES.join(', ')}`);
    if (!RARITY_VALUES.includes(rarity)) {
      errors.push(`${label}.rarity must be one of: ${RARITY_VALUES.join(', ')}`);
    }

    const family = familyById.get(familyId);
    if (!family) {
      errors.push(`${label}.familyId is not present in the current LPC index: ${familyId || '(empty)'}`);
      return;
    }
    if (family.availableVariants.length > 0 && !family.availableVariants.includes(variant)) {
      errors.push(
        `${label}.variant "${variant}" is not available for ${familyId}; expected one of: ${family.availableVariants.join(', ')}`
      );
    }
    if (family.availableVariants.length === 0 && variant) {
      errors.push(`${label}.variant "${variant}" is not indexed for ${familyId}`);
    }

    const item = {
      itemId,
      displayNameAr,
      displayNameEn,
      slot,
      rarity,
      familyId,
      variant,
      bodyType: preferredBodyType(family, rawItem.bodyType),
      sourceFiles: family.sourceFiles.map((file) => file.relativeSourcePath),
      animations: [...family.availableAnimations],
      layers: [...family.availableLayers],
      compatibility: family.compatibility,
      suitability: family.dungeonSuitability,
      warnings: [],
      notes,
    };
    item.warnings = authoritativeWarnings(item, family);
    normalized.push(item);
  });

  for (const [itemId, count] of itemIdCounts) {
    if (count > 1) errors.push(`Duplicate item ID "${itemId}" appears ${count} times`);
  }
  if (errors.length > 0) {
    throw new Error(`Selection validation failed:\n- ${errors.join('\n- ')}`);
  }

  const slotRank = Object.fromEntries(SLOT_VALUES.map((value, index) => [value, index]));
  const rarityRank = Object.fromEntries(RARITY_VALUES.map((value, index) => [value, index]));
  normalized.sort(
    (left, right) =>
      slotRank[left.slot] - slotRank[right.slot] ||
      rarityRank[left.rarity] - rarityRank[right.rarity] ||
      left.itemId.localeCompare(right.itemId)
  );

  const createdAt =
    typeof payload.createdAt === 'string' && Number.isFinite(Date.parse(payload.createdAt))
      ? new Date(payload.createdAt).toISOString()
      : new Date().toISOString();
  return {
    version: VERSION,
    createdAt,
    sourceIndex: '.temp/lpc-library-index',
    items: normalized,
  };
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function selectionCsv(payload) {
  const headers = [
    'itemId',
    'displayNameAr',
    'displayNameEn',
    'slot',
    'rarity',
    'familyId',
    'variant',
    'bodyType',
    'sourceFiles',
    'animations',
    'layers',
    'compatibility',
    'suitability',
    'warnings',
    'notes',
  ];
  return (
    [headers, ...payload.items.map((item) => headers.map((header) => item[header]))]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n') + '\n'
  );
}

function selectionMarkdown(payload) {
  const lines = [
    '# LPC Dungeon Loot Selection',
    '',
    `- Version: \`${payload.version}\``,
    `- Created: ${payload.createdAt}`,
    `- Total items: **${payload.items.length}**`,
    '',
  ];
  for (const slot of SLOT_VALUES) {
    const slotItems = payload.items.filter((item) => item.slot === slot);
    if (slotItems.length === 0) continue;
    lines.push(`## ${slot}`, '');
    for (const rarity of RARITY_VALUES) {
      const items = slotItems.filter((item) => item.rarity === rarity);
      if (items.length === 0) continue;
      lines.push(
        `### ${rarity}`,
        '',
        '| Item ID | Arabic name | English name | Family ID | Variant | Compatibility warnings |',
        '|---|---|---|---|---|---|',
        ...items.map(
          (item) =>
            `| ${item.itemId} | ${item.displayNameAr || '—'} | ${item.displayNameEn || '—'} | ${item.familyId} | ${item.variant || '—'} | ${item.warnings.join('; ') || 'none'} |`
        ),
        ''
      );
    }
  }
  return lines.join('\n');
}

async function replaceOutputDirectoryAtomically(outRoot, files) {
  const parent = path.dirname(outRoot);
  const basename = path.basename(outRoot);
  const nonce = `${process.pid}-${Date.now()}`;
  const staging = path.join(parent, `.${basename}.staging-${nonce}`);
  const backup = path.join(parent, `.${basename}.backup-${nonce}`);
  await mkdir(parent, { recursive: true });
  await mkdir(staging);
  try {
    for (const [fileName, content] of Object.entries(files)) {
      await writeFile(path.join(staging, fileName), content, 'utf8');
    }
    const hadExistingOutput = await pathExists(outRoot);
    if (hadExistingOutput) await rename(outRoot, backup);
    try {
      await rename(staging, outRoot);
    } catch (error) {
      if (hadExistingOutput && (await pathExists(backup))) await rename(backup, outRoot);
      throw error;
    }
    if (hadExistingOutput) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, options.input);
  const indexPath = path.resolve(cwd, options.index);
  const outRoot = path.resolve(cwd, options.out);
  const tempRoot = path.resolve(cwd, '.temp');
  if (outRoot !== tempRoot && !outRoot.startsWith(tempRoot + path.sep)) {
    throw new Error(`Refusing to write outside the project .temp directory: ${outRoot}`);
  }

  const [payloadText, indexText] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readFile(indexPath, 'utf8'),
  ]);
  let payload;
  let index;
  try {
    payload = JSON.parse(payloadText);
  } catch (error) {
    throw new Error(`Input JSON is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    index = JSON.parse(indexText);
  } catch (error) {
    throw new Error(`Index JSON is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(index.families)) throw new Error('Current LPC index does not contain a families array');

  const normalized = validateAndNormalize(payload, index.families);
  await replaceOutputDirectoryAtomically(outRoot, {
    'loot-selection.json': JSON.stringify(normalized, null, 2) + '\n',
    'loot-selection.csv': selectionCsv(normalized),
    'selection-summary.md': selectionMarkdown(normalized),
  });
  console.log(
    `Normalized ${normalized.items.length} selected LPC loot items into ${outRoot}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
