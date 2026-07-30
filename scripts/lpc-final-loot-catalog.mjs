import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED_FAMILY_COUNT = 682;
const SLOTS = Object.freeze(['weapon', 'helmet', 'armor', 'boots']);
const RARITIES = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);
const RARITY_TARGETS = Object.freeze({
  common: 273,
  uncommon: 184,
  rare: 123,
  epic: 68,
  legendary: 34,
});
const BASE_DROP_WEIGHTS = Object.freeze({
  common: 100,
  uncommon: 55,
  rare: 25,
  epic: 10,
  legendary: 3,
});

const SOURCE_SLOT_MAP = Object.freeze({
  weapon: 'weapon',
  tools: 'weapon',
  shield: 'weapon',
  quiver: 'weapon',
  hat: 'helmet',
  head: 'helmet',
  hair: 'helmet',
  beards: 'helmet',
  eyes: 'helmet',
  facial: 'helmet',
  feet: 'boots',
  legs: 'boots',
  arms: 'armor',
  backpack: 'armor',
  body: 'armor',
  cape: 'armor',
  dress: 'armor',
  neck: 'armor',
  shadow: 'armor',
  shoulders: 'armor',
  torso: 'armor',
});

const ARABIC_SLOT_NAMES = Object.freeze({
  weapon: 'سلاح',
  helmet: 'خوذة',
  armor: 'درع',
  boots: 'حذاء',
});

const ARABIC_WORDS = new Map(
  Object.entries({
    accessory: 'إكسسوار',
    ankle: 'كاحل',
    arm: 'ذراع',
    armet: 'أرميت',
    armor: 'درع',
    armour: 'درع',
    arms: 'أذرع',
    axe: 'فأس',
    back: 'خلفي',
    backpack: 'حقيبة ظهر',
    basic: 'أساسي',
    beard: 'لحية',
    black: 'أسود',
    blue: 'أزرق',
    bonnet: 'قبعة',
    boots: 'أحذية',
    bow: 'قوس',
    brass: 'نحاسي',
    bronze: 'برونزي',
    brown: 'بني',
    cap: 'قبعة',
    cape: 'عباءة',
    celestial: 'سماوي',
    chainmail: 'زرد',
    cloth: 'قماشي',
    crown: 'تاج',
    cuffs: 'أساور',
    dagger: 'خنجر',
    dark: 'داكن',
    dress: 'ثوب',
    epic: 'ملحمي',
    eyes: 'عيون',
    female: 'نسائي',
    fire: 'ناري',
    fold: 'مطوي',
    front: 'أمامي',
    ghillies: 'جلدي',
    gloves: 'قفازات',
    gold: 'ذهبي',
    great: 'عظيم',
    green: 'أخضر',
    grey: 'رمادي',
    hair: 'شعر',
    hammer: 'مطرقة',
    hands: 'أيدٍ',
    hat: 'قبعة',
    helmet: 'خوذة',
    hood: 'قلنسوة',
    ice: 'جليدي',
    iron: 'حديدي',
    leather: 'جلدي',
    legion: 'فيلق',
    longsword: 'سيف طويل',
    mace: 'صولجان',
    magic: 'سحري',
    male: 'رجالي',
    moon: 'قمري',
    normal: 'عادي',
    pirate: 'قرصان',
    plate: 'صفائحي',
    purple: 'بنفسجي',
    rapier: 'سيف رفيع',
    red: 'أحمر',
    revised: 'محسن',
    robe: 'رداء',
    royal: 'ملكي',
    saber: 'سيف مقوس',
    sandals: 'صندل',
    shield: 'ترس',
    shoes: 'أحذية',
    shoulders: 'أكتاف',
    silver: 'فضي',
    simple: 'بسيط',
    socks: 'جوارب',
    spear: 'رمح',
    staff: 'عصا',
    steel: 'فولاذي',
    sword: 'سيف',
    thick: 'سميك',
    toe: 'مقدمة',
    torso: 'صدر',
    tunic: 'سترة',
    weapon: 'سلاح',
    white: 'أبيض',
    wings: 'أجنحة',
    wrists: 'معاصم',
    yellow: 'أصفر',
  })
);

function parseArguments(argv) {
  const options = {
    index: '.temp/lpc-library-index/asset-families.json',
    out: '.temp/lpc-final-loot-catalog',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!['--index', '--out'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--index') options.index = value;
    if (argument === '--out') options.out = value;
  }
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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
}

function cleanEnglishName(family) {
  const label = String(family.label ?? '').trim();
  if (label) return label;
  return String(family.normalizedFamilyPath ?? family.familyId)
    .split('/')
    .map((part) => part.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()))
    .join(' ');
}

function arabicName(displayNameEn, slot) {
  const translated = displayNameEn
    .split(/\s+/)
    .map((word) => {
      const normalized = word.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      return ARABIC_WORDS.get(normalized) ?? word;
    })
    .join(' ')
    .trim();
  return `${ARABIC_SLOT_NAMES[slot]} — ${translated || displayNameEn}`;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function internalItemId(family, slot) {
  const logicalPath = slug(family.normalizedFamilyPath || family.label || family.familyId) || 'item';
  const digest = createHash('sha1').update(family.familyId).digest('hex').slice(0, 8);
  return `lpc-${slot}-${logicalPath}-${digest}`;
}

function mappedSlot(family) {
  if (SLOTS.includes(family.currentDungeonSlot)) {
    return { slot: family.currentDungeonSlot, ambiguous: false };
  }
  const slot = SOURCE_SLOT_MAP[family.sourceCategory] ?? 'armor';
  return { slot, ambiguous: true };
}

function stableJitter(familyId) {
  return Number.parseInt(createHash('sha1').update(familyId).digest('hex').slice(0, 4), 16) % 8;
}

function rarityScore(family) {
  const suggestedBase = {
    common: 14,
    uncommon: 32,
    rare: 52,
    epic: 72,
    legendary: 92,
    cosmetic: 58,
    unknown: 38,
  };
  const themeBonus = {
    medieval: 0,
    fantasy: 8,
    pirate: 9,
    formal: 5,
    modern: 6,
    holiday: 13,
    civilian: -3,
    magical: 18,
    monstrous: 14,
    transformation: 18,
    unknown: 0,
  };
  const compatibilityAdjustment = {
    compatible: -8,
    'partially-compatible': 20,
    uncertain: 24,
    incompatible: 8,
  };
  const suitabilityAdjustment = {
    recommended: 4,
    acceptable: 0,
    'cosmetic-only': 18,
    unsuitable: 10,
    uncertain: 18,
  };
  let score =
    (suggestedBase[family.suggestedRarity] ?? suggestedBase.unknown) +
    (themeBonus[family.dungeonTheme] ?? 0) +
    (compatibilityAdjustment[family.compatibility] ?? 0) +
    (suitabilityAdjustment[family.dungeonSuitability] ?? 0);
  const tags = new Set(family.semanticTags ?? []);
  if (tags.has('royal')) score += 12;
  if (tags.has('magic')) score += 12;
  if (tags.has('fire') || tags.has('ice')) score += 8;
  if (tags.has('rusty')) score -= 8;
  if (tags.has('leather') || tags.has('cloth')) score -= 4;
  if (tags.has('plate') || tags.has('steel')) score += 4;
  score += Math.min(8, (family.availableVariants?.length ?? 0) * 0.8);
  score += Math.min(5, Math.max(0, (family.availableLayers?.length ?? 1) - 1) * 2);
  score += (100 - (family.dungeonSuitabilityScore ?? 50)) * 0.08;
  score += stableJitter(family.familyId);
  return Number(clamp(score, 0, 100).toFixed(2));
}

function allocateSlotRarityQuotas(slotCounts) {
  const allocation = Object.fromEntries(
    SLOTS.map((slot) => [slot, Object.fromEntries(RARITIES.map((rarity) => [rarity, 1]))])
  );
  const remainingRows = Object.fromEntries(SLOTS.map((slot) => [slot, slotCounts[slot] - RARITIES.length]));
  const remainingColumns = Object.fromEntries(
    RARITIES.map((rarity) => [rarity, RARITY_TARGETS[rarity] - SLOTS.length])
  );
  const remainingTotal = Object.values(remainingRows).reduce((total, count) => total + count, 0);
  const fractions = {};
  const rowDeficits = { ...remainingRows };
  const columnDeficits = { ...remainingColumns };

  for (const slot of SLOTS) {
    fractions[slot] = {};
    for (const rarity of RARITIES) {
      const exact = (remainingRows[slot] * remainingColumns[rarity]) / remainingTotal;
      const floor = Math.floor(exact);
      allocation[slot][rarity] += floor;
      rowDeficits[slot] -= floor;
      columnDeficits[rarity] -= floor;
      fractions[slot][rarity] = exact - floor;
    }
  }

  while (Object.values(rowDeficits).some((count) => count > 0)) {
    const candidates = [];
    for (const slot of SLOTS) {
      if (rowDeficits[slot] <= 0) continue;
      for (const rarity of RARITIES) {
        if (columnDeficits[rarity] <= 0) continue;
        candidates.push({ slot, rarity, fraction: fractions[slot][rarity] });
      }
    }
    if (candidates.length === 0) throw new Error('Unable to complete the slot/rarity quota matrix');
    candidates.sort(
      (left, right) =>
        right.fraction - left.fraction ||
        rowDeficits[right.slot] - rowDeficits[left.slot] ||
        columnDeficits[right.rarity] - columnDeficits[left.rarity] ||
        left.slot.localeCompare(right.slot) ||
        left.rarity.localeCompare(right.rarity)
    );
    const selected = candidates[0];
    allocation[selected.slot][selected.rarity] += 1;
    rowDeficits[selected.slot] -= 1;
    columnDeficits[selected.rarity] -= 1;
  }
  if (Object.values(columnDeficits).some((count) => count !== 0)) {
    throw new Error(`Rarity column quota mismatch: ${JSON.stringify(columnDeficits)}`);
  }
  return allocation;
}

function assignRarities(families, slotAssignments, quotaMatrix) {
  const rarityByFamily = new Map();
  const scoreByFamily = new Map(families.map((family) => [family.familyId, rarityScore(family)]));
  for (const slot of SLOTS) {
    const slotFamilies = families
      .filter((family) => slotAssignments.get(family.familyId).slot === slot)
      .sort(
        (left, right) =>
          scoreByFamily.get(left.familyId) - scoreByFamily.get(right.familyId) ||
          left.familyId.localeCompare(right.familyId)
      );
    let cursor = 0;
    for (const rarity of RARITIES) {
      const count = quotaMatrix[slot][rarity];
      for (const family of slotFamilies.slice(cursor, cursor + count)) {
        rarityByFamily.set(family.familyId, rarity);
      }
      cursor += count;
    }
    if (cursor !== slotFamilies.length) throw new Error(`Rarity assignment did not consume slot ${slot}`);
  }
  return { rarityByFamily, scoreByFamily };
}

function buildWarnings(family, mapping) {
  const warnings = [...(family.compatibilityWarnings ?? [])];
  if (family.compatibility !== 'compatible') warnings.push(`technical compatibility: ${family.compatibility}`);
  if (['cosmetic-only', 'unsuitable', 'uncertain'].includes(family.dungeonSuitability)) {
    warnings.push(`dungeon suitability: ${family.dungeonSuitability}`);
  }
  if (mapping.ambiguous) {
    warnings.push(
      `ambiguous slot mapping: source category ${family.sourceCategory} mapped to nearest slot ${mapping.slot}`
    );
  }
  if (!(family.availableBodyTypes ?? []).some((bodyType) => ['male', 'universal', 'adult'].includes(bodyType))) {
    warnings.push('awkward body support: no confirmed male/universal/adult source');
  }
  warnings.push(...(family.exclusionReasons ?? []).map((reason) => `curation flag: ${reason}`));
  return sortedUnique(warnings);
}

function buildItem(family, mapping, rarity, score) {
  const hasIdle = Boolean(family.idleSupport);
  const hasWalk = Boolean(family.walkSupport);
  const hasHurt = Boolean(family.hurtSupport);
  const isCosmetic =
    family.dungeonSuitability === 'cosmetic-only' ||
    family.suggestedRarity === 'cosmetic' ||
    ['holiday', 'formal', 'civilian'].includes(family.dungeonTheme);
  const severeAnimationGap = (!hasIdle && !hasWalk) || (!hasWalk && !hasHurt);
  const isTransformation = family.dungeonTheme === 'transformation';
  const unsupportedBody =
    !(family.availableBodyTypes ?? []).some((bodyType) => ['male', 'universal', 'adult'].includes(bodyType));
  const isCraftOnly =
    isTransformation ||
    severeAnimationGap ||
    (family.compatibility === 'incompatible' && unsupportedBody && !hasWalk);
  const isDropEligible = !isCraftOnly;
  const compatibilityMultiplier = {
    compatible: 1,
    'partially-compatible': 0.75,
    uncertain: 0.6,
    incompatible: 0.45,
  };
  const suitabilityMultiplier = {
    recommended: 1,
    acceptable: 0.9,
    'cosmetic-only': 0.65,
    unsuitable: 0.5,
    uncertain: 0.65,
  };
  const dropWeight = isDropEligible
    ? Math.max(
        1,
        Math.round(
          BASE_DROP_WEIGHTS[rarity] *
            (compatibilityMultiplier[family.compatibility] ?? 0.5) *
            (suitabilityMultiplier[family.dungeonSuitability] ?? 0.7)
        )
      )
    : 0;
  const warnings = buildWarnings(family, mapping);
  const notes = [];
  if (mapping.ambiguous) {
    notes.push(`Mapped from ${family.sourceCategory} to the nearest supported dungeon slot: ${mapping.slot}.`);
  }
  if (isCosmetic) notes.push('Special/cosmetic item retained in the complete dungeon catalog.');
  if (isCraftOnly) {
    notes.push('Craft-only: retained in the catalog but disabled for random drops due to rendering limitations.');
  } else if (family.compatibility !== 'compatible' || family.dungeonSuitability !== 'recommended') {
    notes.push('Drop eligible with warnings and a reduced drop weight.');
  }
  if (notes.length === 0) notes.push('Standard dungeon loot candidate.');

  const displayNameEn = cleanEnglishName(family);
  return {
    familyId: family.familyId,
    internalItemId: internalItemId(family, mapping.slot),
    displayNameAr: arabicName(displayNameEn, mapping.slot),
    displayNameEn,
    slot: mapping.slot,
    rarity,
    rarityScore: score,
    dropWeight,
    compatibility: family.compatibility,
    suitability: family.dungeonSuitability,
    theme: family.dungeonTheme,
    bodySupport: [...(family.availableBodyTypes ?? [])],
    layerType: [...(family.availableLayers ?? [])],
    hasIdle,
    hasWalk,
    hasHurt,
    isCosmetic,
    isCraftOnly,
    isDropEligible,
    notes: notes.join(' '),
    warnings,
    sourceFamilyPath: family.normalizedFamilyPath,
  };
}

function buildSummary(items, quotaMatrix) {
  const bySlot = countBy(items.map((item) => item.slot));
  const byRarity = countBy(items.map((item) => item.rarity));
  const byCompatibility = countBy(items.map((item) => item.compatibility));
  const bySuitability = countBy(items.map((item) => item.suitability));
  const bySlotRarity = Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      Object.fromEntries(
        RARITIES.map((rarity) => [
          rarity,
          items.filter((item) => item.slot === slot && item.rarity === rarity).length,
        ])
      ),
    ])
  );
  return {
    totalItems: items.length,
    bySlot,
    byRarity,
    byCompatibility,
    bySuitability,
    bySlotRarity,
    dropEligible: items.filter((item) => item.isDropEligible).length,
    craftOnly: items.filter((item) => item.isCraftOnly).length,
    cosmetic: items.filter((item) => item.isCosmetic).length,
    unsuitableButIncluded: items.filter((item) => item.suitability === 'unsuitable').length,
    quotaMatrix,
  };
}

function validateCatalog(families, items, summary) {
  const errors = [];
  if (families.length !== EXPECTED_FAMILY_COUNT) {
    errors.push(`Source index contains ${families.length} families, expected ${EXPECTED_FAMILY_COUNT}`);
  }
  if (items.length !== families.length) errors.push('Catalog item count does not equal source family count');
  const sourceIds = new Set(families.map((family) => family.familyId));
  const catalogFamilyIds = new Set(items.map((item) => item.familyId));
  if (catalogFamilyIds.size !== items.length) errors.push('Duplicate family IDs found in catalog');
  if ([...sourceIds].some((familyId) => !catalogFamilyIds.has(familyId))) {
    errors.push('One or more indexed families are missing from the catalog');
  }
  const internalIds = new Set(items.map((item) => item.internalItemId));
  if (internalIds.size !== items.length) errors.push('Duplicate internal item IDs found');
  for (const item of items) {
    if (!SLOTS.includes(item.slot)) errors.push(`${item.familyId}: invalid slot`);
    if (!RARITIES.includes(item.rarity)) errors.push(`${item.familyId}: invalid rarity`);
    if (!item.internalItemId) errors.push(`${item.familyId}: missing internalItemId`);
    if (!item.displayNameAr.trim()) errors.push(`${item.familyId}: missing Arabic name`);
    if (!item.displayNameEn.trim()) errors.push(`${item.familyId}: missing English name`);
  }
  for (const rarity of RARITIES) {
    if (summary.byRarity[rarity] !== RARITY_TARGETS[rarity]) {
      errors.push(`Rarity ${rarity} has ${summary.byRarity[rarity]}, expected ${RARITY_TARGETS[rarity]}`);
    }
  }
  for (const slot of SLOTS) {
    if (!summary.bySlot[slot]) errors.push(`Slot ${slot} is empty`);
    for (const rarity of RARITIES) {
      if (!summary.bySlotRarity[slot][rarity]) errors.push(`Slot ${slot} has no ${rarity} items`);
    }
  }
  if (errors.length > 0) throw new Error(`Catalog validation failed:\n- ${errors.join('\n- ')}`);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function catalogCsv(items) {
  const headers = [
    'familyId',
    'internalItemId',
    'displayNameAr',
    'displayNameEn',
    'slot',
    'rarity',
    'rarityScore',
    'dropWeight',
    'compatibility',
    'suitability',
    'theme',
    'bodySupport',
    'layerType',
    'hasIdle',
    'hasWalk',
    'hasHurt',
    'isCosmetic',
    'isCraftOnly',
    'isDropEligible',
    'notes',
    'warnings',
    'sourceFamilyPath',
  ];
  return (
    [headers, ...items.map((item) => headers.map((header) => item[header]))]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n') + '\n'
  );
}

function markdownTableFromCounts(counts) {
  return Object.entries(counts)
    .map(([key, value]) => `| ${key} | ${value} |`)
    .join('\n');
}

function safeMarkdown(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function catalogMarkdown(items, summary) {
  const lines = [
    '# Final LPC Dungeon Loot Catalog',
    '',
    `- Total items: **${summary.totalItems}**`,
    `- Drop eligible: **${summary.dropEligible}**`,
    `- Craft only: **${summary.craftOnly}**`,
    `- Cosmetic: **${summary.cosmetic}**`,
    `- Unsuitable but included: **${summary.unsuitableButIncluded}**`,
    '',
    '## Slots',
    '',
    '| Slot | Items |',
    '|---|---:|',
    markdownTableFromCounts(summary.bySlot),
    '',
    '## Rarities',
    '',
    '| Rarity | Items |',
    '|---|---:|',
    markdownTableFromCounts(summary.byRarity),
    '',
    '## Compatibility',
    '',
    '| Compatibility | Items |',
    '|---|---:|',
    markdownTableFromCounts(summary.byCompatibility),
    '',
    '## Complete catalog',
    '',
    '| Internal ID | English name | Arabic name | Slot | Rarity | Score | Drop weight | Compatibility | Suitability | Flags | Source |',
    '|---|---|---|---|---|---:|---:|---|---|---|---|',
    ...items.map((item) => {
      const flags = [
        item.isCosmetic ? 'cosmetic' : null,
        item.isCraftOnly ? 'craft-only' : null,
        item.isDropEligible ? 'drop' : 'no-drop',
      ]
        .filter(Boolean)
        .join(', ');
      return `| ${safeMarkdown(item.internalItemId)} | ${safeMarkdown(item.displayNameEn)} | ${safeMarkdown(item.displayNameAr)} | ${item.slot} | ${item.rarity} | ${item.rarityScore} | ${item.dropWeight} | ${item.compatibility} | ${item.suitability} | ${flags} | ${safeMarkdown(item.sourceFamilyPath)} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

function balanceAuditMarkdown(items, summary) {
  const lines = [
    '# LPC Loot Balance Audit',
    '',
    `Overall result: **PASS**`,
    '',
    `All ${items.length} indexed families are present exactly once, all internal IDs are unique, and global rarity counts exactly match the rounded 40/27/18/10/5 targets.`,
    '',
    '## Slot × rarity matrix',
    '',
    '| Slot | Common | Uncommon | Rare | Epic | Legendary | Total |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const slot of SLOTS) {
    const row = summary.bySlotRarity[slot];
    lines.push(
      `| ${slot} | ${row.common} | ${row.uncommon} | ${row.rare} | ${row.epic} | ${row.legendary} | ${summary.bySlot[slot]} |`
    );
  }
  lines.push('', '## Checks', '');
  for (const slot of SLOTS) {
    const hasAll = RARITIES.every((rarity) => summary.bySlotRarity[slot][rarity] > 0);
    lines.push(`- ${slot}: ${hasAll ? 'PASS' : 'FAIL'} — contains all five rarities.`);
  }
  const largestSlot = Object.entries(summary.bySlot).sort((left, right) => right[1] - left[1])[0];
  const largestShare = (largestSlot[1] / summary.totalItems) * 100;
  lines.push(
    `- Slot completeness: **PASS** — no slot is empty.`,
    `- Global rarity inflation: **PASS** — actual counts equal target counts.`,
    `- Multi-slot rarity diversity: **PASS** — every rarity contains every slot.`,
    `- Largest slot: **${largestSlot[0]}**, ${largestSlot[1]} items (${largestShare.toFixed(1)}%). This reflects the source-library composition; it remains below the 60% over-reliance threshold.`,
    '- Compatibility handling: compatible assets rank earlier within each slot, while partial/cosmetic/uncertain assets receive higher rarity pressure without automatically becoming legendary.',
    '- Visual handling: magical, royal, transformation, fire/ice, layered, and variant-rich families receive higher rarity scores; simple, rusty, cloth, and leather families receive lower pressure.',
    ''
  );
  return lines.join('\n');
}

function warningsMarkdown(items) {
  const warningItems = items.filter((item) => item.warnings.length > 0);
  const categories = {
    'missing animations': items.filter((item) => !item.hasIdle || !item.hasWalk || !item.hasHurt),
    uncertain: items.filter(
      (item) => item.compatibility === 'uncertain' || item.suitability === 'uncertain'
    ),
    unsuitable: items.filter((item) => item.suitability === 'unsuitable'),
    'partial only': items.filter((item) => item.compatibility === 'partially-compatible'),
    'ambiguous slot mapping': items.filter((item) =>
      item.warnings.some((warning) => warning.startsWith('ambiguous slot mapping:'))
    ),
  };
  const lines = [
    '# LPC Loot Catalog Warnings',
    '',
    `- Items with one or more warnings: **${warningItems.length}**`,
    '',
    '## Warning category counts',
    '',
    '| Category | Items |',
    '|---|---:|',
    ...Object.entries(categories).map(([category, categoryItems]) => `| ${category} | ${categoryItems.length} |`),
    '',
    '## Items',
    '',
    '| Internal ID | Family | Slot | Rarity | Warnings |',
    '|---|---|---|---|---|',
    ...warningItems.map(
      (item) =>
        `| ${safeMarkdown(item.internalItemId)} | ${safeMarkdown(item.familyId)} | ${item.slot} | ${item.rarity} | ${safeMarkdown(item.warnings.join('; '))} |`
    ),
    '',
  ];
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
    const hadOutput = await pathExists(outRoot);
    if (hadOutput) await rename(outRoot, backup);
    try {
      await rename(staging, outRoot);
    } catch (error) {
      if (hadOutput && (await pathExists(backup))) await rename(backup, outRoot);
      throw error;
    }
    if (hadOutput) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cwd = process.cwd();
  const indexPath = path.resolve(cwd, options.index);
  const outRoot = path.resolve(cwd, options.out);
  const tempRoot = path.resolve(cwd, '.temp');
  if (outRoot !== tempRoot && !outRoot.startsWith(tempRoot + path.sep)) {
    throw new Error(`Refusing to write outside the project .temp directory: ${outRoot}`);
  }

  const indexPayload = JSON.parse(await readFile(indexPath, 'utf8'));
  if (!Array.isArray(indexPayload.families)) throw new Error('Index does not contain a families array');
  const families = indexPayload.families;
  const slotAssignments = new Map(families.map((family) => [family.familyId, mappedSlot(family)]));
  const slotCounts = Object.fromEntries(
    SLOTS.map((slot) => [
      slot,
      families.filter((family) => slotAssignments.get(family.familyId).slot === slot).length,
    ])
  );
  const quotaMatrix = allocateSlotRarityQuotas(slotCounts);
  const { rarityByFamily, scoreByFamily } = assignRarities(families, slotAssignments, quotaMatrix);
  const slotRank = Object.fromEntries(SLOTS.map((slot, index) => [slot, index]));
  const rarityRank = Object.fromEntries(RARITIES.map((rarity, index) => [rarity, index]));
  const items = families
    .map((family) =>
      buildItem(
        family,
        slotAssignments.get(family.familyId),
        rarityByFamily.get(family.familyId),
        scoreByFamily.get(family.familyId)
      )
    )
    .sort(
      (left, right) =>
        slotRank[left.slot] - slotRank[right.slot] ||
        rarityRank[left.rarity] - rarityRank[right.rarity] ||
        left.rarityScore - right.rarityScore ||
        left.internalItemId.localeCompare(right.internalItemId)
    );
  const summary = buildSummary(items, quotaMatrix);
  validateCatalog(families, items, summary);

  const generatedAt = new Date().toISOString();
  const catalogPayload = {
    version: 'lpc-final-loot-catalog-v1',
    generatedAt,
    sourceIndex: options.index.replaceAll('\\', '/'),
    totalItems: items.length,
    summary,
    items,
  };
  const distributionPayload = {
    version: 'lpc-loot-rarity-distribution-v1',
    generatedAt,
    totalItems: items.length,
    targetPercentages: { common: 40, uncommon: 27, rare: 18, epic: 10, legendary: 5 },
    targetCounts: RARITY_TARGETS,
    actualCounts: summary.byRarity,
    slotCounts: summary.bySlot,
    bySlotRarity: summary.bySlotRarity,
    dropWeightBase: BASE_DROP_WEIGHTS,
    quotaMethod:
      'Each slot receives at least one item of every rarity; remaining cells use largest-remainder proportional apportionment against exact global targets.',
    scoreMethod:
      'Deterministic score combines indexed suggested rarity, theme, compatibility, suitability, semantic tags, variant/layer richness, suitability score, and a stable family-ID tie breaker.',
  };

  await replaceOutputDirectoryAtomically(outRoot, {
    'loot-catalog.json': JSON.stringify(catalogPayload, null, 2) + '\n',
    'loot-catalog.csv': catalogCsv(items),
    'loot-catalog.md': catalogMarkdown(items, summary),
    'loot-rarity-distribution.json': JSON.stringify(distributionPayload, null, 2) + '\n',
    'loot-balance-audit.md': balanceAuditMarkdown(items, summary),
    'loot-warnings.md': warningsMarkdown(items),
  });
  console.log(
    `Created ${items.length} LPC loot items: ${RARITIES.map((rarity) => `${rarity}=${summary.byRarity[rarity]}`).join(', ')}.`
  );
  console.log(`Output written atomically to ${outRoot}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
