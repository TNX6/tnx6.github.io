import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, opendir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';

const OUTPUT_FILES = Object.freeze([
  'library-files.json',
  'asset-families.json',
  'dungeon-compatible.json',
  'asset-families.csv',
  'dungeon-compatible.csv',
  'summary.json',
  'summary.md',
  'scan-errors.json',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.webp']);
const DEFAULT_CONCURRENCY = 24;
const FRAME_SIZE = 64;
const DEFAULT_GALLERY_LIMIT = 1000;

const ANIMATION_ALIASES = new Map([
  ['idle', 'idle'],
  ['walk', 'walk'],
  ['hurt', 'hurt'],
  ['slash', 'slash'],
  ['attack_slash', 'slash'],
  ['1h_slash', 'slash'],
  ['backslash', 'slash'],
  ['1h_backslash', 'slash'],
  ['halfslash', 'slash'],
  ['1h_halfslash', 'slash'],
  ['thrust', 'thrust'],
  ['shoot', 'shoot'],
  ['spellcast', 'spellcast'],
  ['combat', 'combat'],
  ['combat_idle', 'combat'],
]);

const KNOWN_OTHER_ANIMATIONS = new Set(['watering', 'run', 'jump', 'sit', 'emote', 'climb', 'cast', 'swing', 'attack']);

const BODY_ALIASES = new Map([
  ['male', 'male'],
  ['female', 'female'],
  ['universal', 'universal'],
  ['adult', 'adult'],
  ['child', 'child'],
  ['teen', 'teen'],
  ['thin', 'female'],
  ['muscular', 'muscular'],
  ['pregnant', 'pregnant'],
]);

const LAYER_ALIASES = new Map([
  ['bg', 'bg'],
  ['background', 'bg'],
  ['fg', 'fg'],
  ['foreground', 'fg'],
  ['behind', 'behind'],
  ['back', 'behind'],
  ['front', 'front'],
]);

const COLOR_WORDS = new Set([
  'amber',
  'ash',
  'beige',
  'black',
  'blue',
  'bluegray',
  'brass',
  'bronze',
  'brown',
  'charcoal',
  'copper',
  'cream',
  'dark',
  'forest',
  'gold',
  'golden',
  'gray',
  'green',
  'grey',
  'iron',
  'lavender',
  'leather',
  'light',
  'maroon',
  'metal',
  'navy',
  'orange',
  'pink',
  'purple',
  'red',
  'silver',
  'steel',
  'tan',
  'teal',
  'white',
  'wood',
  'wooden',
  'yellow',
]);

const BROAD_LIBRARY_CATEGORIES = new Map([
  ['arms', 'arms'],
  ['backpack', 'backpack'],
  ['beards', 'beard'],
  ['body', 'body'],
  ['cape', 'cape'],
  ['dress', 'dress'],
  ['eyes', 'eyes'],
  ['facial', 'facial'],
  ['feet', 'boots'],
  ['hair', 'hair'],
  ['hat', 'helmet'],
  ['head', 'head'],
  ['legs', 'legs'],
  ['neck', 'neck'],
  ['quiver', 'quiver'],
  ['shadow', 'body'],
  ['shield', 'shield'],
  ['shoulders', 'armor'],
  ['tools', 'other'],
  ['torso', 'armor'],
  ['weapon', 'weapon'],
]);

const CLEAR_WEAPON_TOOL_WORDS = new Set([
  'axe',
  'battleaxe',
  'club',
  'flail',
  'hammer',
  'hatchet',
  'hoe',
  'mace',
  'pickaxe',
  'scythe',
  'shovel',
  'sickle',
  'spear',
  'staff',
]);

const DUNGEON_SUITABILITIES = Object.freeze([
  'recommended',
  'acceptable',
  'cosmetic-only',
  'unsuitable',
  'uncertain',
]);
const DUNGEON_THEMES = Object.freeze([
  'medieval',
  'fantasy',
  'pirate',
  'formal',
  'modern',
  'holiday',
  'civilian',
  'magical',
  'monstrous',
  'transformation',
  'unknown',
]);
const SUGGESTED_RARITIES = Object.freeze([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'cosmetic',
  'unknown',
]);

const SEMANTIC_TAG_PATTERNS = Object.freeze([
  ['leather', /(?:^|[\/_-])leather(?:$|[\/_-])/],
  ['iron', /(?:^|[\/_-])iron(?:$|[\/_-])/],
  ['steel', /(?:^|[\/_-])steel(?:$|[\/_-])/],
  ['cloth', /(?:^|[\/_-])(?:cloth|fabric)(?:$|[\/_-])/],
  ['plate', /(?:^|[\/_-])plate(?:$|[\/_-])/],
  ['rusty', /(?:^|[\/_-])(?:rust|rusty|worn|patched)(?:$|[\/_-])/],
  ['royal', /(?:^|[\/_-])(?:royal|king|queen|crown|crowned)(?:$|[\/_-])/],
  ['magic', /(?:^|[\/_-])(?:magic|magical|wizard|sorcer|arcane|crystal|diamond|staff|wand)(?:$|[\/_-])/],
  ['fire', /(?:^|[\/_-])(?:fire|flame|flaming|inferno)(?:$|[\/_-])/],
  ['ice', /(?:^|[\/_-])(?:ice|icy|frost|frozen)(?:$|[\/_-])/],
  ['pirate', /(?:^|[\/_-])(?:pirate|buccaneer|corsair)(?:$|[\/_-])/],
  ['holiday', /(?:^|[\/_-])(?:santa|christmas|xmas|holiday|festive)(?:$|[\/_-])/],
  ['formal', /(?:^|[\/_-])(?:formal|bowler|tophat|top_hat|business|suit|tie)(?:$|[\/_-])/],
  ['civilian', /(?:^|[\/_-])(?:apron|aprons|suspender|suspenders|overalls|ordinary|shirt|shirts|shortsleeve|longsleeve|obi|slipper|slippers)(?:$|[\/_-])/],
  ['animal', /(?:^|[\/_-])(?:animal|hoof|hoofs|hooves|paw|paws|claw|claws|tail|tails|horn|horns)(?:$|[\/_-])/],
  ['body-transformation', /(?:^|[\/_-])(?:transformation|wings|wing|lizard|zombie|skeleton|demon|monster|merfolk)(?:$|[\/_-])/],
]);

const MEDIEVAL_IDENTITY_PATTERN =
  /(?:^|[\/_-])(?:sword|dagger|axe|battleaxe|mace|hammer|spear|bow|staff|wand|shield|helmet|helm|cap|hood|crown|armour|armor|chain|chainmail|plate|leather|robe|tunic|boot|shoe|greave|sandal)(?:$|[\/_-])/;
const CLEAR_IDENTITY_PATTERN =
  /(?:^|[\/_-])(?:sword|dagger|axe|mace|hammer|spear|bow|staff|wand|helmet|helm|cap|hood|crown|armour|armor|chain|plate|robe|tunic|boot|shoe|greave|sandal)(?:$|[\/_-])/;
const NOVELTY_PATTERN =
  /(?:^|[\/_-])(?:bunny|clown|costume|novelty|pumpkin|party|unicorn|underwear|briefs|boxers)(?:$|[\/_-])/;

function parseArguments(argv) {
  const options = {
    source: null,
    out: null,
    curatedOut: null,
    galleryOut: null,
    galleryLimit: DEFAULT_GALLERY_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (!['--source', '--out', '--curated-out', '--gallery-out', '--gallery-limit', '--concurrency'].includes(argument)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    index += 1;
    if (argument === '--source') options.source = value;
    if (argument === '--out') options.out = value;
    if (argument === '--curated-out') options.curatedOut = value;
    if (argument === '--gallery-out') options.galleryOut = value;
    if (argument === '--gallery-limit') options.galleryLimit = Number(value);
    if (argument === '--concurrency') options.concurrency = Number(value);
  }

  if (!options.source) throw new Error('Missing required option: --source');
  if (!options.out) throw new Error('Missing required option: --out');
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 64) {
    throw new Error('--concurrency must be an integer between 1 and 64');
  }
  if (!Number.isInteger(options.galleryLimit) || options.galleryLimit < 1 || options.galleryLimit > 5000) {
    throw new Error('--gallery-limit must be an integer between 1 and 5000');
  }
  return options;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function normalizeToken(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[\s-]+/g, '_');
}

function titleCase(value) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function animationFromToken(value) {
  const normalized = normalizeToken(value);
  if (ANIMATION_ALIASES.has(normalized)) return ANIMATION_ALIASES.get(normalized);
  if (/(?:^|_)(?:backslash|halfslash|slash)(?:_|$)/.test(normalized)) return 'slash';
  if (/(?:^|_)thrust(?:_|$)/.test(normalized)) return 'thrust';
  if (/(?:^|_)shoot(?:_|$)/.test(normalized)) return 'shoot';
  if (/(?:^|_)spellcast(?:_|$)/.test(normalized)) return 'spellcast';
  if (/(?:^|_)combat_idle(?:_|$)/.test(normalized)) return 'combat';
  return null;
}

function bodyTypeFromToken(value) {
  const normalized = normalizeToken(value);
  if (BODY_ALIASES.has(normalized)) return BODY_ALIASES.get(normalized);
  for (const [alias, bodyType] of BODY_ALIASES) {
    if (new RegExp(`(?:^|_)${alias}(?:_|$)`).test(normalized)) return bodyType;
  }
  return null;
}

function layerRoleFromToken(value) {
  const normalized = normalizeToken(value);
  if (LAYER_ALIASES.has(normalized)) return LAYER_ALIASES.get(normalized);
  const priority = [
    ['background', 'bg'],
    ['foreground', 'fg'],
    ['behind', 'behind'],
    ['front', 'front'],
    ['bg', 'bg'],
    ['fg', 'fg'],
  ];
  for (const [alias, role] of priority) {
    if (new RegExp(`(?:^|_)${alias}(?:_|$)`).test(normalized)) return role;
  }
  return null;
}

function isStructuralToken(value) {
  const normalized = normalizeToken(value);
  return Boolean(
    animationFromToken(normalized) ||
      bodyTypeFromToken(normalized) ||
      layerRoleFromToken(normalized) ||
      KNOWN_OTHER_ANIMATIONS.has(normalized)
  );
}

function detectAnimation(tokens) {
  for (const token of tokens) {
    const animation = animationFromToken(token);
    if (animation) return animation;
  }
  return 'unknown';
}

function detectBodyType(tokens) {
  for (const token of tokens) {
    const bodyType = bodyTypeFromToken(token);
    if (bodyType) return bodyType;
  }
  return 'unknown';
}

function detectLayerRole(tokens) {
  for (const token of tokens) {
    const role = layerRoleFromToken(token);
    if (role) return role;
  }
  return 'main';
}

function detectVariant(pathSegments, animation) {
  const fileStem = normalizeToken(path.parse(pathSegments.at(-1)).name);
  if (
    isStructuralToken(fileStem)
  ) {
    return 'unknown';
  }

  const meaningfulDirectories = pathSegments
    .slice(1, -1)
    .map(normalizeToken)
    .filter(
      (token) =>
        !isStructuralToken(token)
    );

  if (fileStem === meaningfulDirectories.at(-1)) return 'unknown';
  if (animation !== 'unknown' || COLOR_WORDS.has(fileStem)) return fileStem || 'unknown';
  return 'unknown';
}

function classifySlot(topLevelCategory, tokens) {
  const libraryCategory = BROAD_LIBRARY_CATEGORIES.get(topLevelCategory) ?? 'other';
  if (topLevelCategory === 'weapon') {
    return { libraryCategory, dungeonSlotCandidate: 'weapon', currentDungeonSlot: 'weapon' };
  }
  if (topLevelCategory === 'tools') {
    const isWeapon = tokens.some((token) => CLEAR_WEAPON_TOOL_WORDS.has(normalizeToken(token)));
    return {
      libraryCategory: isWeapon ? 'weapon' : 'other',
      dungeonSlotCandidate: isWeapon ? 'weapon' : 'other',
      currentDungeonSlot: isWeapon ? 'weapon' : null,
    };
  }
  if (topLevelCategory === 'hat') {
    return { libraryCategory, dungeonSlotCandidate: 'helmet', currentDungeonSlot: 'helmet' };
  }
  if (topLevelCategory === 'head') {
    const isArmor = tokens.some((token) =>
      ['armor', 'armour', 'hat', 'helmet', 'helm'].includes(normalizeToken(token))
    );
    return {
      libraryCategory: isArmor ? 'helmet' : 'head',
      dungeonSlotCandidate: isArmor ? 'helmet' : 'other',
      currentDungeonSlot: isArmor ? 'helmet' : null,
    };
  }
  if (['torso', 'arms', 'shoulders'].includes(topLevelCategory)) {
    return { libraryCategory: 'armor', dungeonSlotCandidate: 'armor', currentDungeonSlot: 'armor' };
  }
  if (topLevelCategory === 'feet') {
    return { libraryCategory: 'boots', dungeonSlotCandidate: 'boots', currentDungeonSlot: 'boots' };
  }
  return {
    libraryCategory,
    dungeonSlotCandidate: libraryCategory,
    currentDungeonSlot: null,
  };
}

function deriveFamily(relativePath) {
  const pathSegments = relativePath.split('/');
  const topLevelCategory = normalizeToken(pathSegments[0] ?? 'unknown');
  const animation = detectAnimation(pathSegments);
  const bodyType = detectBodyType(pathSegments);
  const layerRole = detectLayerRole(pathSegments);
  const paletteVariant = detectVariant(pathSegments, animation);
  const normalizedParts = [];

  for (const segment of pathSegments.slice(0, -1)) {
    const token = normalizeToken(segment);
    if (
      isStructuralToken(token) ||
      COLOR_WORDS.has(token)
    ) {
      continue;
    }
    normalizedParts.push(token);
  }

  const fileStem = normalizeToken(path.parse(pathSegments.at(-1)).name);
  if (
    normalizedParts.length <= 1 &&
    !isStructuralToken(fileStem) &&
    !COLOR_WORDS.has(fileStem)
  ) {
    normalizedParts.push(fileStem);
  }

  if (normalizedParts.length === 0) normalizedParts.push(topLevelCategory, fileStem || 'unknown');
  const normalizedFamilyPath = normalizedParts.join('/');
  const digest = createHash('sha1').update(normalizedFamilyPath).digest('hex').slice(0, 12);
  const slug = normalizedFamilyPath.replace(/[^a-z0-9/]+/g, '-').replaceAll('/', '--');
  const labelParts = normalizedParts.slice(1);
  const labelSource = labelParts.slice(-2).join(' ') || normalizedParts.at(-1);
  const slot = classifySlot(topLevelCategory, pathSegments);

  return {
    familyId: `${slug}--${digest}`,
    normalizedFamilyPath,
    label: titleCase(labelSource),
    topLevelCategory,
    itemFamily: normalizedFamilyPath,
    bodyType,
    animation,
    layerRole,
    paletteVariant,
    ...slot,
  };
}

async function* walkFiles(root) {
  const directory = await opendir(root);
  for await (const entry of directory) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(absolutePath);
    } else if (entry.isFile()) {
      yield absolutePath;
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findCreditsFile(sourceRoot) {
  let current = sourceRoot;
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(current, 'CREDITS.csv');
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function loadCredits(sourceRoot) {
  const creditsPath = await findCreditsFile(sourceRoot);
  if (!creditsPath) return { creditsPath: null, byPath: new Map() };
  const rows = parseCsv((await readFile(creditsPath, 'utf8')).replace(/^\uFEFF/, ''));
  const headers = rows.shift()?.map((value) => value.trim()) ?? [];
  const byPath = new Map();
  for (const values of rows) {
    if (values.length === 0) continue;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const key = toPosix(record.filename ?? '')
      .replace(/^spritesheets\//, '')
      .replace(/\/$/, '');
    if (!key) continue;
    byPath.set(key, {
      key,
      notes: record.notes || null,
      authors: (record.authors ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      licenses: (record.licenses ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      urls: (record.urls ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }
  return { creditsPath, byPath };
}

function findCreditKey(relativePath, creditMap) {
  const candidates = [];
  let current = relativePath;
  candidates.push(current);
  candidates.push(current.replace(/\.[^.]+$/, ''));
  current = path.posix.dirname(current);
  while (current && current !== '.') {
    candidates.push(current);
    current = path.posix.dirname(current);
  }
  return candidates.find((candidate) => creditMap.has(candidate)) ?? null;
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

async function inspectImage(absolutePath, sourceRoot, creditMap) {
  const relativeSourcePath = toPosix(path.relative(sourceRoot, absolutePath));
  const extension = path.extname(absolutePath).toLowerCase();
  const fileStats = await stat(absolutePath);
  const family = deriveFamily(relativeSourcePath);
  const baseRecord = {
    absoluteSourcePath: absolutePath,
    relativeSourcePath,
    extension,
    fileSizeBytes: fileStats.size,
    width: null,
    height: null,
    frameWidth: null,
    frameHeight: null,
    columns: null,
    rows: null,
    topLevelCategory: family.topLevelCategory,
    itemFamily: family.itemFamily,
    familyId: family.familyId,
    bodyType: family.bodyType,
    animation: family.animation,
    layerRole: family.layerRole,
    paletteVariant: family.paletteVariant,
    bodyCompatibility: [family.bodyType],
    dungeonSlotCandidate: family.dungeonSlotCandidate,
    currentDungeonSlot: family.currentDungeonSlot,
    libraryCategory: family.libraryCategory,
    appearsTransparent: null,
    malformed: false,
    unreadable: false,
    error: null,
    creditsKey: findCreditKey(relativeSourcePath, creditMap),
  };

  try {
    const metadata = await sharp(absolutePath, { failOn: 'none', sequentialRead: true }).metadata();
    const width = Number.isInteger(metadata.width) ? metadata.width : null;
    const height = Number.isInteger(metadata.height) ? metadata.height : null;
    const gridCompatible =
      width !== null &&
      height !== null &&
      width > 0 &&
      height > 0 &&
      width % FRAME_SIZE === 0 &&
      height % FRAME_SIZE === 0;

    return {
      ...baseRecord,
      width,
      height,
      frameWidth: gridCompatible ? FRAME_SIZE : null,
      frameHeight: gridCompatible ? FRAME_SIZE : null,
      columns: gridCompatible ? width / FRAME_SIZE : null,
      rows: gridCompatible ? height / FRAME_SIZE : null,
      appearsTransparent:
        typeof metadata.hasAlpha === 'boolean'
          ? metadata.hasAlpha
          : Number.isInteger(metadata.channels)
            ? metadata.channels === 4
            : null,
      malformed: width === null || height === null || width < 1 || height < 1,
      metadataFormat: metadata.format ?? null,
      metadataChannels: metadata.channels ?? null,
    };
  } catch (error) {
    return {
      ...baseRecord,
      malformed: true,
      unreadable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function analyzeFamilyCompatibility(files, currentDungeonSlot) {
  const warnings = [];
  const animations = new Set(files.map((file) => file.animation));
  const bodyTypes = new Set(files.map((file) => file.bodyType));
  const requiredAnimations = ['idle', 'walk', 'hurt'];
  const missingAnimations = requiredAnimations.filter((animation) => !animations.has(animation));
  warnings.push(...missingAnimations.map((animation) => `missing ${animation}`));

  const supportedBody = ['male', 'universal', 'adult'].some((bodyType) => bodyTypes.has(bodyType));
  if (!supportedBody) {
    if ([...bodyTypes].every((bodyType) => ['female', 'child', 'teen', 'pregnant'].includes(bodyType))) {
      warnings.push('female/child/teen only');
    } else {
      warnings.push('no confirmed male, universal, or adult support');
    }
  }

  const requiredFiles = files.filter((file) => requiredAnimations.includes(file.animation));
  const malformed = requiredFiles.some((file) => file.malformed || file.unreadable);
  const nonGrid = requiredFiles.some((file) => file.frameWidth !== FRAME_SIZE || file.frameHeight !== FRAME_SIZE);
  if (malformed) warnings.push('malformed or unreadable required image');
  if (nonGrid) warnings.push('required animation has unknown or non-64x64 frame grid');

  const layers = new Set(files.map((file) => file.layerRole));
  const pairRequirements = [];
  if (layers.has('bg') && layers.has('fg')) pairRequirements.push(['bg', 'fg']);
  if (layers.has('behind') && layers.has('front')) pairRequirements.push(['behind', 'front']);

  let incompleteLayers = false;
  for (const animation of requiredAnimations) {
    const animationLayers = new Set(files.filter((file) => file.animation === animation).map((file) => file.layerRole));
    for (const pair of pairRequirements) {
      if (!pair.every((layer) => animationLayers.has(layer))) {
        incompleteLayers = true;
        warnings.push(`incomplete ${pair.join('/')} pair for ${animation}`);
      }
    }
  }

  if (!currentDungeonSlot) warnings.push('not a current dungeon slot');

  let compatibility = 'compatible';
  if (malformed || !currentDungeonSlot) {
    compatibility = 'incompatible';
  } else if (missingAnimations.length === 0 && supportedBody && !nonGrid && !incompleteLayers) {
    compatibility = 'compatible';
  } else if (missingAnimations.length === 1 || incompleteLayers) {
    compatibility = 'partially-compatible';
  } else if (!supportedBody || nonGrid) {
    compatibility = 'uncertain';
  } else {
    compatibility = 'incompatible';
  }

  return { compatibility, warnings: sortedUnique(warnings) };
}

function deriveSemanticTags(normalizedFamilyPath) {
  return SEMANTIC_TAG_PATTERNS.filter(([, pattern]) => pattern.test(normalizedFamilyPath)).map(([tag]) => tag);
}

function classifyDungeonTheme(normalizedFamilyPath, semanticTags, currentDungeonSlot) {
  if (semanticTags.includes('holiday')) return 'holiday';
  if (semanticTags.includes('body-transformation')) return 'transformation';
  if (semanticTags.includes('animal')) return 'monstrous';
  if (semanticTags.includes('pirate')) return 'pirate';
  if (semanticTags.includes('formal')) return 'formal';
  if (/(?:^|[\/_-])(?:modern|urban|sci_fi|scifi|gun|pistol|rifle)(?:$|[\/_-])/.test(normalizedFamilyPath)) {
    return 'modern';
  }
  if (semanticTags.includes('civilian')) return 'civilian';
  if (semanticTags.some((tag) => ['magic', 'fire', 'ice'].includes(tag))) return 'magical';
  if (MEDIEVAL_IDENTITY_PATTERN.test(normalizedFamilyPath) || currentDungeonSlot) return 'medieval';
  return 'unknown';
}

function deriveExclusionReasons(normalizedFamilyPath, semanticTags, currentDungeonSlot, compatibilityWarnings) {
  const reasons = [];
  if (!currentDungeonSlot) reasons.push('not a current dungeon equipment slot');
  if (semanticTags.includes('holiday')) reasons.push('holiday costume or novelty');
  if (semanticTags.includes('body-transformation')) reasons.push('body transformation rather than equipment');
  if (semanticTags.includes('animal')) reasons.push('animal anatomy or body part');
  if (semanticTags.includes('formal')) reasons.push('modern formal/cosmetic styling');
  if (semanticTags.includes('civilian')) reasons.push('civilian-only clothing');
  if (NOVELTY_PATTERN.test(normalizedFamilyPath)) reasons.push('obvious novelty or underwear item');
  if (/(?:^|[\/_-])(?:hoof|hoofs|hooves)(?:$|[\/_-])/.test(normalizedFamilyPath)) reasons.push('animal hoof footwear');
  if (/(?:^|[\/_-])(?:slipper|slippers)(?:$|[\/_-])/.test(normalizedFamilyPath)) {
    reasons.push('slippers are unsuitable as dungeon equipment by default');
  }
  reasons.push(
    ...compatibilityWarnings
      .filter((warning) => warning.startsWith('missing ') || warning.startsWith('incomplete '))
      .map((warning) => `technical: ${warning}`)
  );
  return sortedUnique(reasons);
}

function deriveSuggestedRarity(normalizedFamilyPath, semanticTags, theme) {
  if (['holiday', 'formal', 'civilian'].includes(theme)) return 'cosmetic';
  if (
    semanticTags.includes('rusty') ||
    /(?:^|[\/_-])(?:basic|simple|common|cloth|leather)(?:$|[\/_-])/.test(normalizedFamilyPath)
  ) {
    return 'common';
  }
  if (
    semanticTags.some((tag) => ['iron', 'steel'].includes(tag)) ||
    /(?:^|[\/_-])(?:chain|chainmail|tunic)(?:$|[\/_-])/.test(normalizedFamilyPath)
  ) {
    return 'uncommon';
  }
  if (
    semanticTags.some((tag) => ['plate', 'royal', 'pirate'].includes(tag)) ||
    /(?:^|[\/_-])(?:ornate|noble)(?:$|[\/_-])/.test(normalizedFamilyPath)
  ) {
    return 'rare';
  }
  if (
    semanticTags.some((tag) => ['magic', 'fire', 'ice'].includes(tag)) ||
    /(?:^|[\/_-])(?:enchanted|arcane)(?:$|[\/_-])/.test(normalizedFamilyPath)
  ) {
    return 'epic';
  }
  if (/(?:^|[\/_-])(?:legendary|celestial|dragon|mythic)(?:$|[\/_-])/.test(normalizedFamilyPath)) {
    return 'legendary';
  }
  return 'unknown';
}

function scoreDungeonSuitability({
  normalizedFamilyPath,
  animations,
  bodyTypes,
  variants,
  authors,
  licenses,
  averageDepth,
  compatibilityWarnings,
  theme,
  semanticTags,
  currentDungeonSlot,
  allRequiredFilesGridCompatible,
}) {
  let score = 0;
  for (const animation of ['idle', 'walk', 'hurt']) {
    if (animations.includes(animation)) score += 15;
  }
  if (bodyTypes.some((bodyType) => ['male', 'universal', 'adult'].includes(bodyType))) score += 12;
  if (allRequiredFilesGridCompatible) score += 10;
  if (!compatibilityWarnings.some((warning) => warning.startsWith('incomplete '))) score += 8;
  if (['medieval', 'fantasy', 'pirate', 'magical'].includes(theme)) score += 12;
  if (CLEAR_IDENTITY_PATTERN.test(normalizedFamilyPath)) score += 6;
  score += Math.min(variants.length, 4);
  if (authors.length > 0 && licenses.length > 0) score += 5;
  if (averageDepth <= 6) score += 5;
  else if (averageDepth <= 8) score += 3;

  if (!currentDungeonSlot) score -= 30;
  if (theme === 'holiday') score -= 55;
  if (theme === 'civilian') score -= 20;
  if (theme === 'formal') score -= 18;
  if (theme === 'transformation') score -= 55;
  if (semanticTags.includes('animal')) score -= 35;
  if (NOVELTY_PATTERN.test(normalizedFamilyPath)) score -= 45;
  if (bodyTypes.every((bodyType) => bodyType === 'unknown')) score -= 5;
  score -= compatibilityWarnings.filter((warning) => warning.startsWith('missing ')).length * 5;
  if (compatibilityWarnings.some((warning) => warning.startsWith('incomplete '))) score -= 15;
  if (authors.length === 0 || licenses.length === 0) score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function classifyDungeonSuitability({
  compatibility,
  currentDungeonSlot,
  normalizedFamilyPath,
  theme,
  semanticTags,
  score,
}) {
  const hardExclusion =
    !currentDungeonSlot ||
    ['holiday', 'transformation'].includes(theme) ||
    semanticTags.includes('animal') ||
    NOVELTY_PATTERN.test(normalizedFamilyPath) ||
    /(?:^|[\/_-])(?:hoof|hoofs|hooves|slipper|slippers|underwear|briefs|boxers)(?:$|[\/_-])/.test(normalizedFamilyPath);
  if (hardExclusion || compatibility === 'incompatible') return 'unsuitable';
  if (['formal', 'civilian'].includes(theme)) return 'cosmetic-only';
  if (compatibility === 'uncertain') return 'uncertain';
  if (
    compatibility === 'compatible' &&
    score >= 70 &&
    ['medieval', 'fantasy', 'pirate', 'magical'].includes(theme)
  ) {
    return 'recommended';
  }
  if (
    ['compatible', 'partially-compatible'].includes(compatibility) &&
    score >= 45 &&
    ['medieval', 'fantasy', 'pirate', 'magical'].includes(theme)
  ) {
    return 'acceptable';
  }
  return compatibility === 'compatible' ? 'acceptable' : 'uncertain';
}

function buildFamilies(files, sourceRoot, creditsPath, creditMap) {
  const grouped = new Map();
  for (const file of files) {
    if (!grouped.has(file.familyId)) grouped.set(file.familyId, []);
    grouped.get(file.familyId).push(file);
  }

  const families = [];
  for (const [familyId, familyFiles] of grouped) {
    familyFiles.sort((left, right) => left.relativeSourcePath.localeCompare(right.relativeSourcePath));
    const example = familyFiles[0];
    const animations = sortedUnique(familyFiles.map((file) => file.animation));
    const bodyTypes = sortedUnique(familyFiles.map((file) => file.bodyType));
    const layers = sortedUnique(familyFiles.map((file) => file.layerRole));
    const variants = sortedUnique(
      familyFiles.map((file) => file.paletteVariant).filter((variant) => variant !== 'unknown')
    );
    const creditKeys = sortedUnique(familyFiles.map((file) => file.creditsKey).filter(Boolean));
    const creditRows = creditKeys.map((key) => creditMap.get(key)).filter(Boolean);
    const authors = sortedUnique(creditRows.flatMap((row) => row.authors));
    const licenses = sortedUnique(creditRows.flatMap((row) => row.licenses));
    const { compatibility, warnings } = analyzeFamilyCompatibility(familyFiles, example.currentDungeonSlot);

    const averageDepth =
      familyFiles.reduce((total, file) => total + file.relativeSourcePath.split('/').length, 0) / familyFiles.length;
    const coherentLayers = !warnings.some((warning) => warning.startsWith('incomplete '));
    const allRequiredFilesGridCompatible = familyFiles
      .filter((file) => ['idle', 'walk', 'hurt'].includes(file.animation))
      .every((file) => file.frameWidth === FRAME_SIZE && file.frameHeight === FRAME_SIZE && !file.malformed);
    const semanticTags = deriveSemanticTags(example.itemFamily);
    const dungeonTheme = classifyDungeonTheme(example.itemFamily, semanticTags, example.currentDungeonSlot);
    const exclusionReasons = deriveExclusionReasons(
      example.itemFamily,
      semanticTags,
      example.currentDungeonSlot,
      warnings
    );
    const dungeonSuitabilityScore = scoreDungeonSuitability({
      normalizedFamilyPath: example.itemFamily,
      animations,
      bodyTypes,
      variants,
      authors,
      licenses,
      averageDepth,
      compatibilityWarnings: warnings,
      theme: dungeonTheme,
      semanticTags,
      currentDungeonSlot: example.currentDungeonSlot,
      allRequiredFilesGridCompatible,
    });
    const dungeonSuitability = classifyDungeonSuitability({
      compatibility,
      currentDungeonSlot: example.currentDungeonSlot,
      normalizedFamilyPath: example.itemFamily,
      theme: dungeonTheme,
      semanticTags,
      score: dungeonSuitabilityScore,
    });
    const suggestedRarity = deriveSuggestedRarity(example.itemFamily, semanticTags, dungeonTheme);
    const recommendationScore =
      (animations.includes('idle') ? 100 : 0) +
      (animations.includes('walk') ? 100 : 0) +
      (animations.includes('hurt') ? 100 : 0) +
      (bodyTypes.some((bodyType) => ['male', 'universal', 'adult'].includes(bodyType)) ? 80 : 0) +
      (coherentLayers ? 30 : 0) +
      Math.min(variants.length, 20) * 2 +
      (authors.length > 0 && licenses.length > 0 ? 20 : 0) +
      Math.max(0, 20 - averageDepth);

    families.push({
      familyId,
      label: titleCase(example.itemFamily.split('/').slice(-2).join(' ')),
      normalizedFamilyPath: example.itemFamily,
      sourceCategory: example.topLevelCategory,
      libraryCategory: example.libraryCategory,
      currentDungeonSlot: example.currentDungeonSlot,
      sourceRoot,
      sourceFiles: familyFiles.map((file) => ({
        relativeSourcePath: file.relativeSourcePath,
        animation: file.animation,
        bodyType: file.bodyType,
        layerRole: file.layerRole,
        paletteVariant: file.paletteVariant,
        width: file.width,
        height: file.height,
        columns: file.columns,
        rows: file.rows,
        appearsTransparent: file.appearsTransparent,
      })),
      availableAnimations: animations,
      availableBodyTypes: bodyTypes,
      availableLayers: layers,
      availableColorsPalettes: variants,
      availableVariants: variants,
      idleSupport: animations.includes('idle'),
      walkSupport: animations.includes('walk'),
      hurtSupport: animations.includes('hurt'),
      maleSupport: bodyTypes.includes('male'),
      femaleSupport: bodyTypes.includes('female'),
      universalSupport: bodyTypes.includes('universal'),
      adultSupport: bodyTypes.includes('adult'),
      totalFileCount: familyFiles.length,
      totalSourceSize: familyFiles.reduce((total, file) => total + file.fileSizeBytes, 0),
      compatibility,
      compatibilityWarnings: warnings,
      dungeonTheme,
      dungeonSuitability,
      dungeonSuitabilityScore,
      suggestedRarity,
      exclusionReasons,
      semanticTags,
      authors: authors.length > 0 ? authors : null,
      licenses: licenses.length > 0 ? licenses : null,
      creditsSourcePath: creditRows.length > 0 ? creditsPath : null,
      creditsCandidates: creditKeys,
      sourceExample: example.relativeSourcePath,
      recommendationScore: Number(recommendationScore.toFixed(2)),
    });
  }

  return families.sort((left, right) => left.familyId.localeCompare(right.familyId));
}

function recommendationSort(left, right) {
  const suitabilityRank = {
    recommended: 4,
    acceptable: 3,
    'cosmetic-only': 2,
    uncertain: 1,
    unsuitable: 0,
  };
  const compatibilityRank = {
    compatible: 3,
    'partially-compatible': 2,
    uncertain: 1,
    incompatible: 0,
  };
  return (
    suitabilityRank[right.dungeonSuitability] - suitabilityRank[left.dungeonSuitability] ||
    right.dungeonSuitabilityScore - left.dungeonSuitabilityScore ||
    compatibilityRank[right.compatibility] - compatibilityRank[left.compatibility] ||
    right.recommendationScore - left.recommendationScore ||
    right.availableVariants.length - left.availableVariants.length ||
    left.totalFileCount - right.totalFileCount ||
    left.familyId.localeCompare(right.familyId)
  );
}

function summarize(files, families, allDiscoveredCount, elapsedMs) {
  const compatible = families.filter((family) => family.compatibility === 'compatible');
  const recommendations = {};
  for (const slot of ['weapon', 'helmet', 'armor', 'boots']) {
    recommendations[slot] = families
      .filter(
        (family) =>
          family.currentDungeonSlot === slot &&
          ['recommended', 'acceptable'].includes(family.dungeonSuitability)
      )
      .sort(recommendationSort)
      .slice(0, 20)
      .map((family) => ({
        familyId: family.familyId,
        label: family.label,
        sourceExample: family.sourceExample,
        variants: family.availableVariants,
        animations: family.availableAnimations,
        bodyTypes: family.availableBodyTypes,
        layers: family.availableLayers,
        compatibility: family.compatibility,
        dungeonSuitability: family.dungeonSuitability,
        dungeonTheme: family.dungeonTheme,
        suggestedRarity: family.suggestedRarity,
        warnings: family.compatibilityWarnings,
        score: family.dungeonSuitabilityScore,
      }));
  }

  const largestByFiles = [...families]
    .sort((left, right) => right.totalFileCount - left.totalFileCount || left.familyId.localeCompare(right.familyId))
    .slice(0, 20)
    .map((family) => ({
      familyId: family.familyId,
      label: family.label,
      fileCount: family.totalFileCount,
      totalBytes: family.totalSourceSize,
    }));
  const largestBySize = [...families]
    .sort((left, right) => right.totalSourceSize - left.totalSourceSize || left.familyId.localeCompare(right.familyId))
    .slice(0, 20)
    .map((family) => ({
      familyId: family.familyId,
      label: family.label,
      fileCount: family.totalFileCount,
      totalBytes: family.totalSourceSize,
    }));

  return {
    generatedAt: new Date().toISOString(),
    scanDurationMs: elapsedMs,
    scanDuration: formatElapsed(elapsedMs),
    totalFilesDiscovered: allDiscoveredCount,
    totalImageFilesIndexed: files.length,
    unreadableFiles: files.filter((file) => file.unreadable).length,
    malformedFiles: files.filter((file) => file.malformed).length,
    totalBytesIndexed: files.reduce((total, file) => total + file.fileSizeBytes, 0),
    uniqueAssetFamilies: families.length,
    confirmedDungeonCompatibleFamilies: compatible.length,
    partiallyCompatibleFamilies: families.filter((family) => family.compatibility === 'partially-compatible').length,
    incompatibleFamilies: families.filter((family) => family.compatibility === 'incompatible').length,
    uncertainFamilies: families.filter((family) => family.compatibility === 'uncertain').length,
    familyCountsByTopLevelCategory: countBy(families.map((family) => family.sourceCategory)),
    familyCountsByCurrentDungeonSlot: countBy(families.map((family) => family.currentDungeonSlot ?? 'none')),
    familyCountsByAnimationSupport: countBy(families.flatMap((family) => family.availableAnimations)),
    familyCountsByBodyType: countBy(families.flatMap((family) => family.availableBodyTypes)),
    familyCountsByLayerType: countBy(families.flatMap((family) => family.availableLayers)),
    uniqueColorVariants: new Set(families.flatMap((family) => family.availableVariants)).size,
    dungeonSuitabilityCounts: countBy(families.map((family) => family.dungeonSuitability)),
    dungeonThemeCounts: countBy(families.map((family) => family.dungeonTheme)),
    suggestedRarityCounts: countBy(families.map((family) => family.suggestedRarity)),
    largestFamiliesByFileCount: largestByFiles,
    largestFamiliesByDiskSize: largestBySize,
    estimatedActualUniqueVisualItems: families.length,
    rawFileToLogicalFamilyDifference: files.length - families.length,
    currentDungeonSlotCompatibleCounts: countBy(compatible.map((family) => family.currentDungeonSlot)),
    curatedCountsByCurrentDungeonSlot: countBy(
      families
        .filter((family) => ['recommended', 'acceptable'].includes(family.dungeonSuitability))
        .map((family) => family.currentDungeonSlot)
    ),
    dungeonSuitabilityScoring: {
      positive:
        '15 points each for idle/walk/hurt; 12 for male/universal/adult; 10 for valid 64x64 grids; 8 for coherent layers; 12 for medieval/fantasy/pirate/magical theme; 6 for clear item identity; up to 4 for variants; 5 for credits; up to 5 for simple paths.',
      penalties:
        'Holiday -55; transformation -55; novelty/underwear -45; animal anatomy -35; no current slot -30; civilian -20; formal -18; missing animation -5 each; incomplete layer pair -15; unknown body -5; unclear credits -5.',
      range: 'Scores are rounded and clamped to 0-100. Technical compatibility remains strict and is not inferred from suitability.',
    },
    recommendations,
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' | ') : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function familyCsv(families) {
  const headers = [
    'familyId',
    'label',
    'category',
    'currentDungeonSlot',
    'compatibility',
    'dungeonSuitability',
    'dungeonSuitabilityScore',
    'dungeonTheme',
    'suggestedRarity',
    'semanticTags',
    'exclusionReasons',
    'animations',
    'bodyTypes',
    'layers',
    'colors',
    'fileCount',
    'totalBytes',
    'sourceExample',
    'warnings',
  ];
  const rows = families.map((family) => [
    family.familyId,
    family.label,
    family.sourceCategory,
    family.currentDungeonSlot,
    family.compatibility,
    family.dungeonSuitability,
    family.dungeonSuitabilityScore,
    family.dungeonTheme,
    family.suggestedRarity,
    family.semanticTags,
    family.exclusionReasons,
    family.availableAnimations,
    family.availableBodyTypes,
    family.availableLayers,
    family.availableVariants,
    family.totalFileCount,
    family.totalSourceSize,
    family.sourceExample,
    family.compatibilityWarnings,
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function markdownTable(counts) {
  return Object.entries(counts)
    .map(([name, count]) => `| ${name} | ${count} |`)
    .join('\n');
}

function summaryMarkdown(summary, sourceRoot) {
  const lines = [
    '# Universal LPC Library Index Summary',
    '',
    `- Source: \`${sourceRoot}\``,
    `- Scan duration: **${summary.scanDuration}**`,
    `- Files discovered: **${summary.totalFilesDiscovered.toLocaleString()}**`,
    `- Images indexed: **${summary.totalImageFilesIndexed.toLocaleString()}**`,
    `- Indexed bytes: **${summary.totalBytesIndexed.toLocaleString()}**`,
    `- Logical families: **${summary.uniqueAssetFamilies.toLocaleString()}**`,
    `- Confirmed dungeon-compatible families: **${summary.confirmedDungeonCompatibleFamilies.toLocaleString()}**`,
    `- Partially compatible: **${summary.partiallyCompatibleFamilies.toLocaleString()}**`,
    `- Incompatible: **${summary.incompatibleFamilies.toLocaleString()}**`,
    `- Uncertain: **${summary.uncertainFamilies.toLocaleString()}**`,
    `- Unreadable files: **${summary.unreadableFiles}**`,
    `- Malformed files: **${summary.malformedFiles}**`,
    `- Estimated actual unique visual items: **${summary.estimatedActualUniqueVisualItems.toLocaleString()}**`,
    `- Raw file/logical family difference: **${summary.rawFileToLogicalFamilyDifference.toLocaleString()}**`,
    '',
    '## Current dungeon slot compatibility',
    '',
    '| Slot | Compatible families |',
    '|---|---:|',
    markdownTable(summary.currentDungeonSlotCompatibleCounts),
    '',
    '## Dungeon suitability',
    '',
    '| Classification | Families |',
    '|---|---:|',
    markdownTable(summary.dungeonSuitabilityCounts),
    '',
    '## Curated slot counts',
    '',
    '| Slot | Recommended or acceptable |',
    '|---|---:|',
    markdownTable(summary.curatedCountsByCurrentDungeonSlot),
    '',
    '## Top-level categories',
    '',
    '| Category | Families |',
    '|---|---:|',
    markdownTable(summary.familyCountsByTopLevelCategory),
    '',
    '## Animation support',
    '',
    '| Animation | Families |',
    '|---|---:|',
    markdownTable(summary.familyCountsByAnimationSupport),
    '',
    '## Body types',
    '',
    '| Body type | Families |',
    '|---|---:|',
    markdownTable(summary.familyCountsByBodyType),
    '',
    '## Layer types',
    '',
    '| Layer | Families |',
    '|---|---:|',
    markdownTable(summary.familyCountsByLayerType),
    '',
    `Unique color/palette variants: **${summary.uniqueColorVariants}**`,
    '',
    '## Largest families by file count',
    '',
    '| Family | Files | Bytes |',
    '|---|---:|---:|',
    ...summary.largestFamiliesByFileCount.map(
      (family) => `| ${family.familyId} | ${family.fileCount} | ${family.totalBytes.toLocaleString()} |`
    ),
    '',
    '## Largest families by disk size',
    '',
    '| Family | Files | Bytes |',
    '|---|---:|---:|',
    ...summary.largestFamiliesByDiskSize.map(
      (family) => `| ${family.familyId} | ${family.fileCount} | ${family.totalBytes.toLocaleString()} |`
    ),
    '',
    '## Recommended families',
    '',
  ];

  for (const slot of ['weapon', 'helmet', 'armor', 'boots']) {
    lines.push(
      `### ${titleCase(slot)}`,
      '',
      '| Rank | Family | Suitability | Theme | Rarity | Compatibility | Example | Score |',
      '|---:|---|---|---|---|---|---|---:|'
    );
    summary.recommendations[slot].forEach((family, index) => {
      lines.push(
        `| ${index + 1} | ${family.familyId} | ${family.dungeonSuitability} | ${family.dungeonTheme} | ${family.suggestedRarity} | ${family.compatibility} | ${family.sourceExample} | ${family.score} |`
      );
    });
    lines.push('');
  }

  lines.push(
    '## Recommendation criteria',
    '',
    'Families are ranked by dungeon suitability first, then the deterministic 0-100 suitability score and strict technical compatibility.',
    '',
    `Positive scoring: ${summary.dungeonSuitabilityScoring.positive}`,
    '',
    `Penalties: ${summary.dungeonSuitabilityScoring.penalties}`,
    '',
    summary.dungeonSuitabilityScoring.range,
    '',
    'No source assets were copied or modified by this index.',
    ''
  );
  return lines.join('\n');
}

function curatedSort(left, right) {
  return (
    right.dungeonSuitabilityScore - left.dungeonSuitabilityScore ||
    recommendationSort(left, right)
  );
}

function buildCuratedSummary(families, curatedFamilies, generatedAt) {
  const bestBySlot = {};
  for (const slot of ['weapon', 'helmet', 'armor', 'boots']) {
    bestBySlot[slot] = curatedFamilies
      .filter((family) => family.currentDungeonSlot === slot)
      .slice(0, 30)
      .map((family) => ({
        familyId: family.familyId,
        label: family.label,
        dungeonSuitability: family.dungeonSuitability,
        dungeonSuitabilityScore: family.dungeonSuitabilityScore,
        dungeonTheme: family.dungeonTheme,
        suggestedRarity: family.suggestedRarity,
        compatibility: family.compatibility,
        sourceExample: family.sourceExample,
      }));
  }
  return {
    generatedAt,
    totalFamilies: families.length,
    curatedFamilies: curatedFamilies.length,
    countsByDungeonSuitability: countBy(families.map((family) => family.dungeonSuitability)),
    curatedCountsBySlot: countBy(curatedFamilies.map((family) => family.currentDungeonSlot)),
    curatedCountsByTheme: countBy(curatedFamilies.map((family) => family.dungeonTheme)),
    curatedCountsByRarity: countBy(curatedFamilies.map((family) => family.suggestedRarity)),
    best30BySlot: bestBySlot,
  };
}

function curatedSummaryMarkdown(summary, sourceRoot) {
  const lines = [
    '# Curated Universal LPC Dungeon Families',
    '',
    `- Source: \`${sourceRoot}\``,
    `- Total indexed families: **${summary.totalFamilies.toLocaleString()}**`,
    `- Recommended or acceptable families: **${summary.curatedFamilies.toLocaleString()}**`,
    '',
    '## Suitability counts',
    '',
    '| Classification | Count |',
    '|---|---:|',
    markdownTable(summary.countsByDungeonSuitability),
    '',
    '## Curated counts by slot',
    '',
    '| Slot | Count |',
    '|---|---:|',
    markdownTable(summary.curatedCountsBySlot),
    '',
  ];
  for (const slot of ['weapon', 'helmet', 'armor', 'boots']) {
    lines.push(
      `## Best 30: ${titleCase(slot)}`,
      '',
      '| Rank | Family | Suitability | Score | Theme | Rarity | Compatibility |',
      '|---:|---|---|---:|---|---|---|'
    );
    summary.best30BySlot[slot].forEach((family, index) => {
      lines.push(
        `| ${index + 1} | ${family.familyId} | ${family.dungeonSuitability} | ${family.dungeonSuitabilityScore} | ${family.dungeonTheme} | ${family.suggestedRarity} | ${family.compatibility} |`
      );
    });
    lines.push('');
  }
  return lines.join('\n');
}

function weaponAnalysisMarkdown(families, oldFamilyCount = 54, oldCompatibleCount = 1) {
  const weapons = families.filter((family) => family.currentDungeonSlot === 'weapon');
  const compatibilityCounts = countBy(weapons.map((family) => family.compatibility));
  const suitabilityCounts = countBy(weapons.map((family) => family.dungeonSuitability));
  const missingCounts = countBy(
    weapons.flatMap((family) =>
      family.compatibilityWarnings.filter((warning) => warning.startsWith('missing '))
    )
  );
  const groupedExamples = weapons
    .filter((family) =>
      family.sourceFiles.some(
        (file) =>
          file.relativeSourcePath.includes('universal_behind') ||
          file.relativeSourcePath.includes('attack_slash_reverse') ||
          file.relativeSourcePath.includes('attack_thrust')
      )
    )
    .sort(curatedSort)
    .slice(0, 30);
  const lines = [
    '# Weapon Family Analysis',
    '',
    `- Previous weapon families: **${oldFamilyCount}**`,
    `- Improved weapon families: **${weapons.length}**`,
    `- Previous confirmed compatible weapon families: **${oldCompatibleCount}**`,
    `- Improved confirmed compatible weapon families: **${weapons.filter((family) => family.compatibility === 'compatible').length}**`,
    '',
    '## Why compatibility remains low',
    '',
    'Most weapon sources genuinely provide walk, hurt, and combat actions but no dedicated idle sheet. Strict dungeon compatibility still requires idle, walk, and hurt, so the indexer does not fabricate idle support.',
    '',
    'The previous index also split composite structural directories such as `universal_behind` and prefixed action directories such as `attack_slash_reverse` and `attack_thrust`. Those tokens are now recognized as body/layer/animation metadata and removed from family identity.',
    '',
    'Color filenames remain variants, bg/fg and behind/front remain layers, and male/universal paths merge when their remaining logical item path is the same.',
    '',
    '## Technical compatibility',
    '',
    '| Status | Families |',
    '|---|---:|',
    markdownTable(compatibilityCounts),
    '',
    '## Dungeon suitability',
    '',
    '| Status | Families |',
    '|---|---:|',
    markdownTable(suitabilityCounts),
    '',
    '## Missing required animation reasons',
    '',
    '| Reason | Families |',
    '|---|---:|',
    markdownTable(missingCounts),
    '',
    '## Families affected by corrected structural-token grouping',
    '',
    '| Family | Compatibility | Animations | Example |',
    '|---|---|---|---|',
    ...groupedExamples.map(
      (family) =>
        `| ${family.familyId} | ${family.compatibility} | ${family.availableAnimations.join(', ')} | ${family.sourceExample} |`
    ),
    '',
  ];
  return lines.join('\n');
}

function exclusionsMarkdown(families) {
  const excluded = families
    .filter((family) => !['recommended', 'acceptable'].includes(family.dungeonSuitability))
    .sort(
      (left, right) =>
        left.dungeonSuitability.localeCompare(right.dungeonSuitability) ||
        right.dungeonSuitabilityScore - left.dungeonSuitabilityScore ||
        left.familyId.localeCompare(right.familyId)
    );
  const reasonCounts = countBy(
    excluded.flatMap((family) =>
      family.exclusionReasons.length > 0 ? family.exclusionReasons : ['technical or thematic uncertainty']
    )
  );
  return [
    '# Dungeon Curation Exclusions',
    '',
    'Excluded families remain present in the complete index. This report only explains why they are not in the recommended/acceptable dungeon set.',
    '',
    '## Reason counts',
    '',
    '| Reason | Count |',
    '|---|---:|',
    markdownTable(reasonCounts),
    '',
    '## Excluded families',
    '',
    '| Family | Slot | Suitability | Score | Theme | Reasons |',
    '|---|---|---|---:|---|---|',
    ...excluded.map(
      (family) =>
        `| ${family.familyId} | ${family.currentDungeonSlot ?? 'none'} | ${family.dungeonSuitability} | ${family.dungeonSuitabilityScore} | ${family.dungeonTheme} | ${(family.exclusionReasons.length > 0 ? family.exclusionReasons : family.compatibilityWarnings).join('; ')} |`
    ),
    '',
  ].join('\n');
}

async function prepareGeneratedDirectory(target, force, knownFiles, removeThumbnailDirectory = false) {
  await mkdir(target, { recursive: true });
  const existing = [];
  for (const fileName of knownFiles) {
    const candidate = path.join(target, fileName);
    if (await pathExists(candidate)) existing.push(candidate);
  }
  const thumbnails = path.join(target, 'thumbnails');
  if (removeThumbnailDirectory && (await pathExists(thumbnails))) existing.push(thumbnails);
  if (existing.length > 0 && !force) {
    throw new Error(`Generated outputs already exist. Re-run with --force:\n${existing.join('\n')}`);
  }
  if (force) {
    for (const candidate of existing) {
      const details = await stat(candidate);
      await rm(candidate, { recursive: details.isDirectory(), force: true });
    }
  }
}

async function writeCuratedOutputs(curatedRoot, sourceRoot, families, generatedAt, force) {
  const outputNames = [
    'curated-families.json',
    'curated-families.csv',
    'curated-summary.json',
    'curated-summary.md',
    'weapon-analysis.md',
    'exclusions.md',
  ];
  await prepareGeneratedDirectory(curatedRoot, force, outputNames);
  const curatedFamilies = families
    .filter((family) => ['recommended', 'acceptable'].includes(family.dungeonSuitability))
    .sort(curatedSort);
  const curatedSummary = buildCuratedSummary(families, curatedFamilies, generatedAt);
  await writeJsonStream(
    path.join(curatedRoot, 'curated-families.json'),
    `{\n  "sourceRoot": ${JSON.stringify(sourceRoot)},\n  "generatedAt": ${JSON.stringify(generatedAt)},\n  "families": [\n`,
    curatedFamilies,
    '\n  ]\n}\n'
  );
  await writeFile(path.join(curatedRoot, 'curated-families.csv'), familyCsv(curatedFamilies), 'utf8');
  await writeFile(
    path.join(curatedRoot, 'curated-summary.json'),
    JSON.stringify(curatedSummary, null, 2) + '\n',
    'utf8'
  );
  await writeFile(
    path.join(curatedRoot, 'curated-summary.md'),
    curatedSummaryMarkdown(curatedSummary, sourceRoot),
    'utf8'
  );
  await writeFile(path.join(curatedRoot, 'weapon-analysis.md'), weaponAnalysisMarkdown(families), 'utf8');
  await writeFile(path.join(curatedRoot, 'exclusions.md'), exclusionsMarkdown(families), 'utf8');
  return { curatedFamilies, curatedSummary };
}

const LAYER_ORDER = Object.freeze({ bg: 0, behind: 1, main: 2, fg: 3, front: 4 });

function choosePreferredVariant(family) {
  const preferences = ['steel', 'iron', 'silver', 'leather', 'brown', 'black', 'bronze', 'red', 'blue'];
  return preferences.find((variant) => family.availableVariants.includes(variant)) ?? family.availableVariants[0] ?? null;
}

function sourceFileRank(file, preferredVariant) {
  const bodyRank = { male: 5, universal: 4, adult: 3, unknown: 2, female: 1 };
  return (
    (bodyRank[file.bodyType] ?? 0) * 100 +
    (preferredVariant && file.paletteVariant === preferredVariant ? 20 : 0) +
    (file.paletteVariant === 'unknown' ? 5 : 0) +
    (file.columns && file.rows ? 2 : 0)
  );
}

function selectPreviewSources(family, animation) {
  const candidates = family.sourceFiles.filter(
    (file) => file.animation === animation && file.columns && file.rows
  );
  if (candidates.length === 0) return [];
  const preferredVariant = choosePreferredVariant(family);
  const byLayer = new Map();
  for (const file of candidates) {
    const current = byLayer.get(file.layerRole);
    if (
      !current ||
      sourceFileRank(file, preferredVariant) > sourceFileRank(current, preferredVariant) ||
      (sourceFileRank(file, preferredVariant) === sourceFileRank(current, preferredVariant) &&
        file.relativeSourcePath.localeCompare(current.relativeSourcePath) < 0)
    ) {
      byLayer.set(file.layerRole, file);
    }
  }
  return [...byLayer.values()].sort(
    (left, right) =>
      (LAYER_ORDER[left.layerRole] ?? 2) - (LAYER_ORDER[right.layerRole] ?? 2) ||
      left.relativeSourcePath.localeCompare(right.relativeSourcePath)
  );
}

async function renderPreviewCell(sourceRoot, family, animation, direction, requestedColumn) {
  const sources = selectPreviewSources(family, animation);
  const warnings = [];
  if (sources.length === 0) {
    warnings.push(`no ${animation} preview source`);
    return {
      buffer: await sharp({
        create: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer(),
      warnings,
    };
  }
  const composites = [];
  for (const source of sources) {
    const row =
      direction === 'front'
        ? Math.min(2, source.rows - 1)
        : direction === 'side'
          ? Math.min(3, source.rows - 1)
          : 0;
    const column = requestedColumn === 'final' ? Math.min(5, source.columns - 1) : Math.min(requestedColumn, source.columns - 1);
    try {
      const input = path.join(sourceRoot, ...source.relativeSourcePath.split('/'));
      const buffer = await sharp(input, { failOn: 'none' })
        .extract({ left: column * FRAME_SIZE, top: row * FRAME_SIZE, width: FRAME_SIZE, height: FRAME_SIZE })
        .png()
        .toBuffer();
      composites.push({ input: buffer, blend: 'over' });
    } catch (error) {
      warnings.push(`${source.relativeSourcePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const canvas = sharp({
    create: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  return {
    buffer: await (composites.length > 0 ? canvas.composite(composites) : canvas).png().toBuffer(),
    warnings,
  };
}

async function renderFamilyThumbnail(sourceRoot, galleryRoot, family) {
  const cells = [
    await renderPreviewCell(sourceRoot, family, 'idle', 'front', 0),
    await renderPreviewCell(sourceRoot, family, 'walk', 'front', 4),
    await renderPreviewCell(sourceRoot, family, 'idle', 'side', 0),
    await renderPreviewCell(sourceRoot, family, 'hurt', 'hurt', 'final'),
  ];
  const strip = await sharp({
    create: {
      width: FRAME_SIZE * cells.length,
      height: FRAME_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(cells.map((cell, index) => ({ input: cell.buffer, left: index * FRAME_SIZE, top: 0 })))
    .resize(FRAME_SIZE * cells.length * 2, FRAME_SIZE * 2, { kernel: 'nearest' })
    .png({ compressionLevel: 9, palette: true })
    .toFile(path.join(galleryRoot, 'thumbnails', `${family.familyId}.png`));
  return {
    thumbnail: `thumbnails/${family.familyId}.png`,
    width: strip.width,
    height: strip.height,
    size: strip.size,
    warnings: sortedUnique(cells.flatMap((cell) => cell.warnings)),
  };
}

function galleryHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Universal LPC Dungeon Curation Gallery</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#101318;color:#edf1f7}
*{box-sizing:border-box}body{margin:0;padding:24px;background:radial-gradient(circle at top,#202938,#0c0f14 55%) fixed}
header{max-width:1500px;margin:auto}.filters{display:grid;grid-template-columns:2fr repeat(7,minmax(120px,1fr));gap:8px;margin:18px 0}
input,select{width:100%;background:#171d27;color:#edf1f7;border:1px solid #3a4557;border-radius:7px;padding:9px}
#count{color:#a9b8cc;margin-bottom:12px}.grid{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:#151b24;border:1px solid #303a4a;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px #0007}
.preview{width:100%;height:auto;display:block;image-rendering:pixelated;image-rendering:crisp-edges;background-color:#111722;background-image:linear-gradient(45deg,#222b38 25%,transparent 25%),linear-gradient(-45deg,#222b38 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#222b38 75%),linear-gradient(-45deg,transparent 75%,#222b38 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.legend{display:grid;grid-template-columns:repeat(4,1fr);font-size:10px;color:#9fb0c6;text-align:center;padding:4px 8px;background:#0d1117}
.content{padding:12px}.title{display:flex;justify-content:space-between;gap:8px;align-items:start}.title h2{font-size:16px;margin:0;word-break:break-word}.score{font-weight:800;color:#7ee787}
.badges{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0}.badge{font-size:11px;padding:3px 6px;border-radius:99px;background:#263247;color:#cad5e4}
.recommended{background:#17492e;color:#9be9b6}.acceptable{background:#4a3a16;color:#ffe19a}.warning{color:#ffb86b;font-size:12px}
.meta{font-size:12px;color:#b9c5d5;line-height:1.45;word-break:break-word}details{margin-top:8px;border-top:1px solid #2a3442;padding-top:8px}summary{cursor:pointer;color:#9ecbff}
pre{white-space:pre-wrap;font-size:10px;background:#0d1117;padding:8px;border-radius:6px;max-height:240px;overflow:auto}
@media(max-width:1000px){.filters{grid-template-columns:1fr 1fr}}@media(max-width:560px){body{padding:12px}.filters{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
<h1>Universal LPC Dungeon Curation Gallery</h1>
<p>Compact source previews: idle front · walk front · idle side · hurt final. Data is embedded locally; no server or fetch is required.</p>
<div class="filters">
<input id="search" placeholder="Search label or source path">
<select id="slot"><option value="">All slots</option></select>
<select id="suitability"><option value="">All suitability</option></select>
<select id="rarity"><option value="">All rarity</option></select>
<select id="theme"><option value="">All themes</option></select>
<select id="body"><option value="">All body support</option></select>
<select id="completeness"><option value="">Any completeness</option><option value="complete">Idle + walk + hurt</option><option value="missing-idle">Missing idle</option><option value="missing-walk">Missing walk</option><option value="missing-hurt">Missing hurt</option></select>
<select id="layer"><option value="">All layer types</option></select>
<select id="variant"><option value="">All colors/variants</option></select>
</div>
<div id="count"></div>
</header>
<main id="grid" class="grid"></main>
<script src="gallery-data.js"></script>
<script>
const data=window.LPC_GALLERY_DATA||{families:[]};
const ids=['slot','suitability','rarity','theme','body','completeness','layer','variant'];
const fields={slot:'currentDungeonSlot',suitability:'dungeonSuitability',rarity:'suggestedRarity',theme:'dungeonTheme'};
const unique=(values)=>[...new Set(values.flat().filter(Boolean))].sort();
function populate(id,values){const el=document.getElementById(id);for(const value of unique(values)){const option=document.createElement('option');option.value=value;option.textContent=value;el.append(option)}}
populate('slot',data.families.map(f=>f.currentDungeonSlot));populate('suitability',data.families.map(f=>f.dungeonSuitability));populate('rarity',data.families.map(f=>f.suggestedRarity));populate('theme',data.families.map(f=>f.dungeonTheme));populate('body',data.families.map(f=>f.availableBodyTypes));populate('layer',data.families.map(f=>f.availableLayers));populate('variant',data.families.map(f=>f.availableVariants));
const esc=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function matches(f){
 const q=document.getElementById('search').value.trim().toLowerCase();
 if(q&&!([f.label,f.familyId,f.sourceExample,...f.sourceFiles].join(' ').toLowerCase().includes(q)))return false;
 for(const id of ['slot','suitability','rarity','theme']){const value=document.getElementById(id).value;if(value&&f[fields[id]]!==value)return false}
 for(const id of ['body','layer','variant']){const value=document.getElementById(id).value;const key=id==='body'?'availableBodyTypes':id==='layer'?'availableLayers':'availableVariants';if(value&&!f[key].includes(value))return false}
 const complete=document.getElementById('completeness').value;
 if(complete==='complete'&&!(f.idleSupport&&f.walkSupport&&f.hurtSupport))return false;
 if(complete==='missing-idle'&&f.idleSupport)return false;if(complete==='missing-walk'&&f.walkSupport)return false;if(complete==='missing-hurt'&&f.hurtSupport)return false;
 return true;
}
function render(){
 const selected=data.families.filter(matches);document.getElementById('count').textContent=selected.length+' of '+data.families.length+' families';
 document.getElementById('grid').innerHTML=selected.map(f=>\`<article class="card">
 <img class="preview" src="\${esc(f.thumbnail)}" alt="\${esc(f.label)} preview"><div class="legend"><span>idle front</span><span>walk front</span><span>idle side</span><span>hurt final</span></div>
 <div class="content"><div class="title"><h2>\${esc(f.label)}</h2><span class="score">\${f.dungeonSuitabilityScore}</span></div>
 <div class="badges"><span class="badge \${esc(f.dungeonSuitability)}">\${esc(f.dungeonSuitability)}</span><span class="badge">\${esc(f.currentDungeonSlot)}</span><span class="badge">\${esc(f.dungeonTheme)}</span><span class="badge">\${esc(f.suggestedRarity)}</span></div>
 <div class="meta"><b>ID:</b> \${esc(f.familyId)}<br><b>Animations:</b> \${esc(f.availableAnimations.join(', '))}<br><b>Bodies:</b> \${esc(f.availableBodyTypes.join(', '))}<br><b>Variants:</b> \${f.availableVariants.length}<br><b>Example:</b> \${esc(f.sourceExample)}</div>
 \${f.warnings.length?'<p class="warning">'+esc(f.warnings.join('; '))+'</p>':''}
 <details><summary>Sources, colors, and credits</summary><div class="meta"><b>Colors:</b> \${esc(f.availableVariants.join(', ')||'none detected')}<br><b>Authors:</b> \${esc((f.authors||[]).join(', ')||'not resolved')}<br><b>Licenses:</b> \${esc((f.licenses||[]).join(', ')||'not resolved')}</div><pre>\${esc(f.sourceFiles.join('\\n'))}</pre></details>
 </div></article>\`).join('');
}
for(const id of ids)document.getElementById(id).addEventListener('change',render);document.getElementById('search').addEventListener('input',render);render();
</script>
</body>
</html>`;
}

function allFamiliesGalleryHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Universal LPC Logical Family Gallery</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#101318;color:#edf1f7}
*{box-sizing:border-box}body{margin:0;padding:24px;background:radial-gradient(circle at top,#202938,#0c0f14 55%) fixed}
header,.toolbar,.grid,.load-more-wrap{max-width:1500px;margin-left:auto;margin-right:auto}
.summary{display:flex;flex-wrap:wrap;gap:7px;margin:14px 0}.summary span{background:#182131;border:1px solid #344157;border-radius:8px;padding:7px 9px;font-size:12px}
.filters{display:grid;grid-template-columns:2fr repeat(5,minmax(130px,1fr));gap:8px;margin:14px 0}
input,select,button{background:#171d27;color:#edf1f7;border:1px solid #3a4557;border-radius:7px;padding:9px}input,select{width:100%}
.checks{display:flex;flex-wrap:wrap;gap:10px 16px;padding:10px;background:#111722;border:1px solid #2e394a;border-radius:8px;margin-bottom:12px}.checks label{font-size:12px;color:#c5d0df}.checks input{width:auto;margin-right:5px}
#count{color:#a9b8cc;margin:10px 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
.card{background:#151b24;border:1px solid #303a4a;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px #0007}
.preview{width:100%;height:auto;display:block;image-rendering:pixelated;image-rendering:crisp-edges;background-color:#111722;background-image:linear-gradient(45deg,#222b38 25%,transparent 25%),linear-gradient(-45deg,#222b38 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#222b38 75%),linear-gradient(-45deg,transparent 75%,#222b38 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.legend{display:grid;grid-template-columns:repeat(4,1fr);font-size:10px;color:#9fb0c6;text-align:center;padding:4px 8px;background:#0d1117}
.content{padding:12px}.title{display:flex;justify-content:space-between;gap:8px;align-items:start}.title h2{font-size:16px;margin:0;word-break:break-word}.score{font-weight:800;color:#7ee787}
.badges{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0}.badge{font-size:11px;padding:3px 6px;border-radius:99px;background:#263247;color:#cad5e4}
.recommended{background:#17492e;color:#9be9b6}.acceptable{background:#4a3a16;color:#ffe19a}.warning,.missing{color:#ffb86b;font-size:12px}.missing{display:block;background:#3d2816;padding:5px 8px}
.meta{font-size:12px;color:#b9c5d5;line-height:1.45;word-break:break-word}details{margin-top:8px;border-top:1px solid #2a3442;padding-top:8px}summary{cursor:pointer;color:#9ecbff}
pre{white-space:pre-wrap;font-size:10px;background:#0d1117;padding:8px;border-radius:6px;max-height:240px;overflow:auto}.load-more-wrap{text-align:center;padding:22px}.load-more-wrap button{min-width:190px;cursor:pointer}.load-more-wrap button[hidden]{display:none}
@media(max-width:1100px){.filters{grid-template-columns:1fr 1fr 1fr}}@media(max-width:650px){body{padding:12px}.filters{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
<h1>Universal LPC Logical Family Gallery</h1>
<p>Browse grouped logical families, not individual source files. Preview order: idle front · walk front · idle side · hurt final.</p>
<div id="summary" class="summary"></div>
</header>
<section class="toolbar">
<div class="filters">
<input id="search" placeholder="Search name, family ID, or source path">
<select id="scope"><option value="curated">Library scope: Curated only</option><option value="compatible">Library scope: Dungeon-compatible</option><option value="all">Library scope: All families</option></select>
<select id="slot"><option value="">All dungeon slots</option></select>
<select id="category"><option value="">All library categories</option></select>
<select id="suitability"><option value="">All suitability</option></select>
<select id="compatibility"><option value="">All compatibility</option></select>
<select id="rarity"><option value="">All rarity</option></select>
<select id="theme"><option value="">All themes</option></select>
<select id="body"><option value="">All body types</option></select>
<select id="animation"><option value="">All animations</option></select>
<select id="layer"><option value="">All layer types</option></select>
<select id="variant"><option value="">All colors/variants</option></select>
</div>
<div class="checks">
<label><input type="checkbox" id="include-partial">Include partially compatible</label>
<label><input type="checkbox" id="include-incompatible">Include incompatible</label>
<label><input type="checkbox" id="include-uncertain">Include uncertain</label>
<label><input type="checkbox" id="include-cosmetic">Include cosmetic</label>
<label><input type="checkbox" id="include-unsuitable">Include unsuitable</label>
</div>
<div id="count"></div>
</section>
<main id="grid" class="grid"></main>
<div class="load-more-wrap"><button id="load-more">Load more</button></div>
<script src="gallery-data.js"></script>
<script>
const data=window.LPC_GALLERY_DATA||{families:[],stats:{}};
const BATCH_SIZE=50;
let filtered=[];
let visibleLimit=BATCH_SIZE;
const selectIds=['scope','slot','category','suitability','compatibility','rarity','theme','body','animation','layer','variant'];
const checkIds=['include-partial','include-incompatible','include-uncertain','include-cosmetic','include-unsuitable'];
const fields={category:'libraryCategory',suitability:'dungeonSuitability',compatibility:'compatibility',rarity:'suggestedRarity',theme:'dungeonTheme'};
const unique=(values)=>[...new Set(values.flat().filter(Boolean))].sort();
function populate(id,values){const el=document.getElementById(id);for(const value of unique(values)){const option=document.createElement('option');option.value=value;option.textContent=value;el.append(option)}}
populate('slot',data.families.map(f=>f.currentDungeonSlot||'none'));
populate('category',data.families.map(f=>f.libraryCategory));
populate('suitability',data.families.map(f=>f.dungeonSuitability));
populate('compatibility',data.families.map(f=>f.compatibility));
populate('rarity',data.families.map(f=>f.suggestedRarity));
populate('theme',data.families.map(f=>f.dungeonTheme));
populate('body',data.families.map(f=>f.availableBodyTypes));
populate('animation',data.families.map(f=>f.availableAnimations));
populate('layer',data.families.map(f=>f.availableLayers));
populate('variant',data.families.map(f=>f.availableVariants));
const esc=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function checked(id){return document.getElementById(id).checked}
function inScope(f){
 const scope=document.getElementById('scope').value;
 const curated=['recommended','acceptable'].includes(f.dungeonSuitability);
 const compatible=f.compatibility==='compatible';
 const extra=(f.compatibility==='partially-compatible'&&checked('include-partial'))||(f.compatibility==='incompatible'&&checked('include-incompatible'))||(f.compatibility==='uncertain'&&checked('include-uncertain'))||(f.dungeonSuitability==='uncertain'&&checked('include-uncertain'))||(f.dungeonSuitability==='cosmetic-only'&&checked('include-cosmetic'))||(f.dungeonSuitability==='unsuitable'&&checked('include-unsuitable'));
 if(scope==='curated')return curated||extra;
 if(scope==='compatible')return compatible||extra;
 if(f.compatibility==='partially-compatible'&&!checked('include-partial'))return false;
 if(f.compatibility==='incompatible'&&!checked('include-incompatible'))return false;
 if(f.compatibility==='uncertain'&&!checked('include-uncertain'))return false;
 if(f.dungeonSuitability==='cosmetic-only'&&!checked('include-cosmetic'))return false;
 if(f.dungeonSuitability==='unsuitable'&&!checked('include-unsuitable'))return false;
 return true;
}
function matches(f){
 if(!inScope(f))return false;
 const q=document.getElementById('search').value.trim().toLowerCase();
 if(q&&!([f.label,f.familyId,f.sourceExample,...f.sourceFiles].join(' ').toLowerCase().includes(q)))return false;
 const slot=document.getElementById('slot').value;if(slot&&(f.currentDungeonSlot||'none')!==slot)return false;
 for(const id of ['category','suitability','compatibility','rarity','theme']){const value=document.getElementById(id).value;if(value&&f[fields[id]]!==value)return false}
 for(const id of ['body','animation','layer','variant']){const value=document.getElementById(id).value;const key=id==='body'?'availableBodyTypes':id==='animation'?'availableAnimations':id==='layer'?'availableLayers':'availableVariants';if(value&&!f[key].includes(value))return false}
 return true;
}
function card(f){
 const missing=f.missingPreviews.length?'<span class="missing">Missing preview cells: '+esc(f.missingPreviews.join(', '))+'</span>':'';
 return '<article class="card">'+missing+
 '<img class="preview" src="'+esc(f.thumbnail)+'" alt="'+esc(f.label)+' preview"><div class="legend"><span>idle front</span><span>walk front</span><span>idle side</span><span>hurt final</span></div>'+
 '<div class="content"><div class="title"><h2>'+esc(f.label)+'</h2><span class="score">'+f.dungeonSuitabilityScore+'</span></div>'+
 '<div class="badges"><span class="badge '+esc(f.dungeonSuitability)+'">'+esc(f.dungeonSuitability)+'</span><span class="badge">'+esc(f.compatibility)+'</span><span class="badge">'+esc(f.currentDungeonSlot||'no slot')+'</span><span class="badge">'+esc(f.libraryCategory)+'</span><span class="badge">'+esc(f.dungeonTheme)+'</span><span class="badge">'+esc(f.suggestedRarity)+'</span></div>'+
 '<div class="meta"><b>ID:</b> '+esc(f.familyId)+'<br><b>Raw files:</b> '+f.totalFileCount+'<br><b>Animations:</b> '+esc(f.availableAnimations.join(', ')||'none detected')+'<br><b>Bodies:</b> '+esc(f.availableBodyTypes.join(', ')||'unknown')+'<br><b>Layers:</b> '+esc(f.availableLayers.join(', ')||'main')+'<br><b>Color variants:</b> '+f.availableVariants.length+'<br><b>Colors:</b> '+esc(f.availableVariants.join(', ')||'none detected')+'<br><b>Example:</b> '+esc(f.sourceExample)+'</div>'+
 (f.warnings.length?'<p class="warning">'+esc(f.warnings.join('; '))+'</p>':'')+
 '<details><summary>All variants, sources, and credits</summary><div class="meta"><b>Variants:</b> '+esc(f.availableVariants.join(', ')||'none detected')+'<br><b>Authors:</b> '+esc((f.authors||[]).join(', ')||'not resolved')+'<br><b>Licenses:</b> '+esc((f.licenses||[]).join(', ')||'not resolved')+'</div><pre>'+esc(f.sourceFiles.join('\\n'))+'</pre></details></div></article>';
}
function render(){
 const shown=filtered.slice(0,visibleLimit);
 document.getElementById('count').textContent='Showing '+filtered.length+' of '+data.stats.totalFamilies+' families · '+shown.length+' cards rendered';
 document.getElementById('grid').innerHTML=shown.map(card).join('');
 const button=document.getElementById('load-more');
 button.hidden=shown.length>=filtered.length;
 button.textContent='Load more ('+Math.min(BATCH_SIZE,filtered.length-shown.length)+' next)';
}
function applyFilters(){filtered=data.families.filter(matches);visibleLimit=BATCH_SIZE;render()}
function setScopeDefaults(){const all=document.getElementById('scope').value==='all';for(const id of checkIds)document.getElementById(id).checked=all;applyFilters()}
const stats=data.stats||{};
document.getElementById('summary').innerHTML=[['Logical families',stats.totalFamilies],['Curated',stats.curatedFamilies],['Technically compatible',stats.compatibleFamilies],['Partial',stats.partiallyCompatibleFamilies],['Incompatible',stats.incompatibleFamilies],['Uncertain',stats.uncertainFamilies]].map(([label,value])=>'<span><b>'+esc(value)+'</b> '+esc(label)+'</span>').join('');
for(const id of selectIds)document.getElementById(id).addEventListener('change',id==='scope'?setScopeDefaults:applyFilters);
for(const id of checkIds)document.getElementById(id).addEventListener('change',applyFilters);
document.getElementById('search').addEventListener('input',applyFilters);
document.getElementById('load-more').addEventListener('click',()=>{visibleLimit+=BATCH_SIZE;render()});
applyFilters();
</script>
</body>
</html>`;
}

function lootSelectionGalleryHtml() {
  let html = allFamiliesGalleryHtml();
  const inlineScriptStart = html.lastIndexOf('<script>');
  const inlineScriptEnd = html.lastIndexOf('</script>') + '</script>'.length;
  html =
    html.slice(0, inlineScriptStart) +
    '<script src="loot-selection-ui.js"></script>' +
    html.slice(inlineScriptEnd);
  html = html.replace(
    '</style>',
    `.selection-panel{position:sticky;top:0;z-index:20;background:#0d121bcc;border:1px solid #3b485d;border-radius:10px;padding:12px;backdrop-filter:blur(10px);box-shadow:0 8px 22px #0008}
.selection-totals{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.selection-totals span{font-size:11px;background:#243047;border-radius:6px;padding:5px 7px}
.selection-actions{display:flex;flex-wrap:wrap;gap:7px}.selection-actions button{cursor:pointer}.selection-errors{font-size:12px;color:#ffb86b;margin:7px 0 0}.loot-editor{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px;padding-top:10px;border-top:1px solid #303a4a}.loot-editor label{font-size:11px;color:#aebdd0}.loot-editor label.full{grid-column:1/-1}.loot-editor input,.loot-editor select{margin-top:3px;padding:7px;font-size:12px}.select-family{display:flex;gap:7px;align-items:center;font-weight:700;color:#dce8f7}.select-family input{width:auto}.field-error{outline:1px solid #ff6b6b}.target-guidance{font-size:11px;color:#a9b8cc;margin-top:8px}
@media(max-width:650px){.loot-editor{grid-template-columns:1fr}.loot-editor label.full{grid-column:auto}}
</style>`
  );
  html = html.replace(
    '<div id="summary" class="summary"></div>',
    `<div id="summary" class="summary"></div>
<aside class="selection-panel" aria-label="Dungeon loot selection">
<strong>Dungeon loot selection</strong>
<div id="selection-totals" class="selection-totals"></div>
<div id="selection-errors" class="selection-errors"></div>
<div class="selection-actions">
<button id="export-json" type="button">Export JSON</button>
<button id="export-csv" type="button">Export CSV</button>
<button id="copy-summary" type="button">Copy selection summary</button>
<button id="import-json" type="button">Import JSON</button>
<button id="clear-selection" type="button">Clear selection</button>
<input id="import-file" type="file" accept=".json,application/json" hidden>
</div>
<div class="target-guidance">Suggested target: 12 weapons · 10 helmets · 10 armor · 8 boots (guidance only)</div>
</aside>`
  );
  html = html.replace(
    '<div class="checks">',
    `<div class="checks">
<label><input type="checkbox" id="show-selected">Show selected only</label>
<label><input type="checkbox" id="show-errors">Show selections with errors only</label>`
  );
  return html;
}

function lootSelectionGalleryScript() {
  return `const data=window.LPC_GALLERY_DATA||{families:[],stats:{}};
const BATCH_SIZE=50;
const SLOT_VALUES=['weapon','helmet','armor','boots'];
const RARITY_VALUES=['common','uncommon','rare','epic','legendary'];
const selection=new Map();
const familyById=new Map(data.families.map(f=>[f.familyId,f]));
let filtered=[];
let visibleLimit=BATCH_SIZE;
const selectIds=['scope','slot','category','suitability','compatibility','rarity','theme','body','animation','layer','variant'];
const checkIds=['include-partial','include-incompatible','include-uncertain','include-cosmetic','include-unsuitable','show-selected','show-errors'];
const fields={category:'libraryCategory',suitability:'dungeonSuitability',compatibility:'compatibility',rarity:'suggestedRarity',theme:'dungeonTheme'};
const unique=values=>[...new Set(values.flat().filter(Boolean))].sort();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attr=esc;
function populate(id,values){const el=document.getElementById(id);for(const value of unique(values)){const option=document.createElement('option');option.value=value;option.textContent=value;el.append(option)}}
populate('slot',data.families.map(f=>f.currentDungeonSlot||'none'));
populate('category',data.families.map(f=>f.libraryCategory));
populate('suitability',data.families.map(f=>f.dungeonSuitability));
populate('compatibility',data.families.map(f=>f.compatibility));
populate('rarity',data.families.map(f=>f.suggestedRarity));
populate('theme',data.families.map(f=>f.dungeonTheme));
populate('body',data.families.map(f=>f.availableBodyTypes));
populate('animation',data.families.map(f=>f.availableAnimations));
populate('layer',data.families.map(f=>f.availableLayers));
populate('variant',data.families.map(f=>f.availableVariants));
function slug(value){return String(value||'item').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'item'}
function preferredBody(f){return ['male','universal','adult'].find(body=>f.availableBodyTypes.includes(body))||'male'}
function defaultDraft(f){
 const variant=f.availableVariants[0]||'';
 const suggested=[f.label,variant].filter(Boolean).join('-');
 return {itemId:slug(suggested),displayNameAr:'',displayNameEn:'',slot:SLOT_VALUES.includes(f.currentDungeonSlot)?f.currentDungeonSlot:'weapon',rarity:RARITY_VALUES.includes(f.suggestedRarity)?f.suggestedRarity:'common',familyId:f.familyId,variant,bodyType:preferredBody(f),notes:''};
}
function draftFor(f){return selection.get(f.familyId)||defaultDraft(f)}
function selectedIdCounts(){const counts=new Map();for(const item of selection.values()){if(item.itemId)counts.set(item.itemId,(counts.get(item.itemId)||0)+1)}return counts}
function blockingErrors(item,f,idCounts){
 const errors=[];
 if(!item.familyId||!familyById.has(item.familyId))errors.push('missing or unknown family ID');
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.itemId||''))errors.push('invalid item ID format');
 if(item.itemId&&(idCounts.get(item.itemId)||0)>1)errors.push('duplicate item ID');
 if(!SLOT_VALUES.includes(item.slot))errors.push('missing or invalid slot');
 if(!RARITY_VALUES.includes(item.rarity))errors.push('missing or invalid rarity');
 if(f&&f.availableVariants.length>0&&!f.availableVariants.includes(item.variant))errors.push('selected variant is not available');
 return errors;
}
function itemWarnings(item,f){
 const warnings=[];
 if(f.compatibility!=='compatible')warnings.push('technical compatibility: '+f.compatibility);
 warnings.push(...f.warnings);
 if(['cosmetic-only','unsuitable','uncertain'].includes(f.dungeonSuitability))warnings.push('dungeon suitability: '+f.dungeonSuitability);
 if(!f.availableVariants.length||!item.variant)warnings.push('no selected indexed variant');
 if(!item.displayNameAr.trim())warnings.push('missing Arabic display name');
 if(!item.displayNameEn.trim())warnings.push('missing English display name');
 if(!f.availableBodyTypes.some(body=>['male','universal','adult'].includes(body)))warnings.push('no confirmed male/universal/adult source support');
 if(!(f.authors||[]).length||!(f.licenses||[]).length)warnings.push('uncertain credits metadata');
 return unique(warnings);
}
function allDiagnostics(){
 const ids=selectedIdCounts();
 return [...selection.values()].map(item=>{const f=familyById.get(item.familyId);return {item,f,errors:blockingErrors(item,f,ids),warnings:f?itemWarnings(item,f):[]}})}
function checked(id){return document.getElementById(id).checked}
function inScope(f){
 const scope=document.getElementById('scope').value;
 const curated=['recommended','acceptable'].includes(f.dungeonSuitability);
 const compatible=f.compatibility==='compatible';
 const extra=(f.compatibility==='partially-compatible'&&checked('include-partial'))||(f.compatibility==='incompatible'&&checked('include-incompatible'))||(f.compatibility==='uncertain'&&checked('include-uncertain'))||(f.dungeonSuitability==='uncertain'&&checked('include-uncertain'))||(f.dungeonSuitability==='cosmetic-only'&&checked('include-cosmetic'))||(f.dungeonSuitability==='unsuitable'&&checked('include-unsuitable'));
 if(scope==='curated')return curated||extra;
 if(scope==='compatible')return compatible||extra;
 if(f.compatibility==='partially-compatible'&&!checked('include-partial'))return false;
 if(f.compatibility==='incompatible'&&!checked('include-incompatible'))return false;
 if(f.compatibility==='uncertain'&&!checked('include-uncertain'))return false;
 if(f.dungeonSuitability==='cosmetic-only'&&!checked('include-cosmetic'))return false;
 if(f.dungeonSuitability==='unsuitable'&&!checked('include-unsuitable'))return false;
 return true;
}
function familyHasDiagnostics(f){
 const item=selection.get(f.familyId);
 if(!item)return false;
 const ids=selectedIdCounts();
 return blockingErrors(item,f,ids).length>0||itemWarnings(item,f).length>0;
}
function matches(f){
 if(!inScope(f))return false;
 if(checked('show-selected')&&!selection.has(f.familyId))return false;
 if(checked('show-errors')&&!familyHasDiagnostics(f))return false;
 const q=document.getElementById('search').value.trim().toLowerCase();
 if(q&&!([f.label,f.familyId,f.sourceExample,...f.sourceFiles].join(' ').toLowerCase().includes(q)))return false;
 const slot=document.getElementById('slot').value;if(slot&&(f.currentDungeonSlot||'none')!==slot)return false;
 for(const id of ['category','suitability','compatibility','rarity','theme']){const value=document.getElementById(id).value;if(value&&f[fields[id]]!==value)return false}
 for(const id of ['body','animation','layer','variant']){const value=document.getElementById(id).value;const key=id==='body'?'availableBodyTypes':id==='animation'?'availableAnimations':id==='layer'?'availableLayers':'availableVariants';if(value&&!f[key].includes(value))return false}
 return true;
}
function optionList(values,current,emptyLabel){
 const prefix=emptyLabel?'<option value="">'+esc(emptyLabel)+'</option>':'';
 return prefix+values.map(value=>'<option value="'+attr(value)+'"'+(value===current?' selected':'')+'>'+esc(value)+'</option>').join('');
}
function card(f){
 const draft=draftFor(f);
 const selected=selection.has(f.familyId);
 const ids=selectedIdCounts();
 const errors=selected?blockingErrors(draft,f,ids):[];
 const warnings=selected?itemWarnings(draft,f):[];
 const missing=f.missingPreviews.length?'<span class="missing">Missing preview cells: '+esc(f.missingPreviews.join(', '))+'</span>':'';
 return '<article class="card" data-family-id="'+attr(f.familyId)+'">'+missing+
 '<img class="preview" src="'+attr(f.thumbnail)+'" alt="'+attr(f.label)+' preview"><div class="legend"><span>idle front</span><span>walk front</span><span>idle side</span><span>hurt final</span></div>'+
 '<div class="content"><div class="title"><h2>'+esc(f.label)+'</h2><span class="score">'+f.dungeonSuitabilityScore+'</span></div>'+
 '<label class="select-family"><input type="checkbox" data-action="select-family"'+(selected?' checked':'')+'> Select for dungeon loot</label>'+
 '<div class="badges"><span class="badge '+attr(f.dungeonSuitability)+'">'+esc(f.dungeonSuitability)+'</span><span class="badge">'+esc(f.compatibility)+'</span><span class="badge">'+esc(f.currentDungeonSlot||'no slot')+'</span><span class="badge">'+esc(f.libraryCategory)+'</span></div>'+
 '<div class="meta"><b>ID:</b> '+esc(f.familyId)+'<br><b>Raw files:</b> '+f.totalFileCount+'<br><b>Animations:</b> '+esc(f.availableAnimations.join(', ')||'none detected')+'<br><b>Bodies:</b> '+esc(f.availableBodyTypes.join(', ')||'unknown')+'<br><b>Layers:</b> '+esc(f.availableLayers.join(', ')||'main')+'<br><b>Variants:</b> '+f.availableVariants.length+' ('+esc(f.availableVariants.join(', ')||'none detected')+')</div>'+
 '<div class="loot-editor">'+
 '<label>Variant<select data-field="variant">'+optionList(f.availableVariants,draft.variant,'No indexed variant')+'</select></label>'+
 '<label>Dungeon slot<select data-field="slot">'+optionList(SLOT_VALUES,draft.slot)+'</select></label>'+
 '<label>Rarity<select data-field="rarity">'+optionList(RARITY_VALUES,draft.rarity)+'</select></label>'+
 '<label>Internal item ID<input data-field="itemId" value="'+attr(draft.itemId)+'" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" class="'+(errors.some(e=>e.includes('item ID'))?'field-error':'')+'"></label>'+
 '<label>Arabic display name<input data-field="displayNameAr" dir="rtl" value="'+attr(draft.displayNameAr)+'"></label>'+
 '<label>English display name<input data-field="displayNameEn" value="'+attr(draft.displayNameEn)+'"></label>'+
 '<label class="full">Optional notes<input data-field="notes" value="'+attr(draft.notes)+'"></label>'+
 '</div>'+
 '<div class="meta"><b>Status:</b> '+esc(f.compatibility)+' · '+esc(f.dungeonSuitability)+'<br><b>Animation warnings:</b> '+esc(f.warnings.filter(w=>/missing (idle|walk|hurt)/.test(w)).join('; ')||'none')+'<br><b>Body support:</b> '+esc(f.availableBodyTypes.join(', ')||'unknown')+'<br><b>Layer requirements:</b> '+esc(f.availableLayers.join(', ')||'main')+'</div>'+
 (errors.length?'<p class="warning"><b>Export-blocking:</b> '+esc(errors.join('; '))+'</p>':'')+
 (warnings.length?'<p class="warning"><b>Warnings:</b> '+esc(warnings.join('; '))+'</p>':'')+
 '<details><summary>All variants, sources, and credits</summary><pre>'+esc(f.sourceFiles.join('\\n'))+'</pre></details></div></article>';
}
function updatePanel(){
 const diagnostics=allDiagnostics();
 const slotCounts=Object.fromEntries(SLOT_VALUES.map(slot=>[slot,0]));
 const rarityCounts=Object.fromEntries(RARITY_VALUES.map(rarity=>[rarity,0]));
 for(const {item} of diagnostics){if(item.slot in slotCounts)slotCounts[item.slot]++;if(item.rarity in rarityCounts)rarityCounts[item.rarity]++}
 const duplicateIds=[...selectedIdCounts().values()].filter(count=>count>1).reduce((total,count)=>total+count,0);
 const incompatible=diagnostics.filter(({f})=>f&&f.compatibility!=='compatible').length;
 const missingVariant=diagnostics.filter(({item})=>!item.variant).length;
 const missingNames=diagnostics.filter(({item})=>!item.displayNameAr.trim()||!item.displayNameEn.trim()).length;
 const blocking=diagnostics.filter(({errors})=>errors.length).length;
 const totals=[['Selected',diagnostics.length],['Weapons',slotCounts.weapon],['Helmets',slotCounts.helmet],['Armor',slotCounts.armor],['Boots',slotCounts.boots],...RARITY_VALUES.map(rarity=>[rarity,rarityCounts[rarity]])];
 document.getElementById('selection-totals').innerHTML=totals.map(([label,value])=>'<span><b>'+value+'</b> '+esc(label)+'</span>').join('');
 document.getElementById('selection-errors').textContent='Duplicate IDs: '+duplicateIds+' · incompatible warnings: '+incompatible+' · missing variants: '+missingVariant+' · missing names: '+missingNames+' · export-blocking selections: '+blocking;
}
function render(){
 const shown=filtered.slice(0,visibleLimit);
 document.getElementById('count').textContent='Showing '+filtered.length+' of '+data.stats.totalFamilies+' families · '+shown.length+' cards rendered';
 document.getElementById('grid').innerHTML=shown.map(card).join('');
 const button=document.getElementById('load-more');button.hidden=shown.length>=filtered.length;button.textContent='Load more ('+Math.min(BATCH_SIZE,filtered.length-shown.length)+' next)';
 updatePanel();
}
function applyFilters(){filtered=data.families.filter(matches);visibleLimit=BATCH_SIZE;render()}
function setScopeDefaults(){const all=document.getElementById('scope').value==='all';for(const id of ['include-partial','include-incompatible','include-uncertain','include-cosmetic','include-unsuitable'])document.getElementById(id).checked=all;applyFilters()}
function normalizedItem(item,f){
 return {itemId:item.itemId,displayNameAr:item.displayNameAr,displayNameEn:item.displayNameEn,slot:item.slot,rarity:item.rarity,familyId:f.familyId,variant:item.variant,bodyType:item.bodyType,sourceFiles:[...f.sourceFiles],animations:[...f.availableAnimations],layers:[...f.availableLayers],compatibility:f.compatibility,suitability:f.dungeonSuitability,warnings:itemWarnings(item,f),notes:item.notes};
}
function sortedItems(){
 const slotRank=Object.fromEntries(SLOT_VALUES.map((value,index)=>[value,index]));
 const rarityRank=Object.fromEntries(RARITY_VALUES.map((value,index)=>[value,index]));
 return [...selection.values()].sort((a,b)=>(slotRank[a.slot]??99)-(slotRank[b.slot]??99)||(rarityRank[a.rarity]??99)-(rarityRank[b.rarity]??99)||a.itemId.localeCompare(b.itemId));
}
function payloadOrAlert(){
 const diagnostics=allDiagnostics();const failures=diagnostics.filter(({errors})=>errors.length);
 if(failures.length){alert('Export blocked. Fix: '+failures.map(({item,errors})=>item.familyId+': '+errors.join(', ')).join('\\n'));return null}
 return {version:'lpc-loot-selection-v1',createdAt:new Date().toISOString(),sourceIndex:'.temp/lpc-library-index',items:sortedItems().map(item=>normalizedItem(item,familyById.get(item.familyId)))};
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
function csvEscape(value){const text=Array.isArray(value)?value.join(' | '):String(value??'');return '"'+text.replaceAll('"','""')+'"'}
function payloadCsv(payload){
 const headers=['itemId','displayNameAr','displayNameEn','slot','rarity','familyId','variant','bodyType','sourceFiles','animations','layers','compatibility','suitability','warnings','notes'];
 return [headers,...payload.items.map(item=>headers.map(key=>item[key]))].map(row=>row.map(csvEscape).join(',')).join('\\n')+'\\n';
}
function summaryMarkdown(payload){
 const lines=['# LPC Dungeon Loot Selection','','- Created: '+payload.createdAt,'- Items: '+payload.items.length,''];
 for(const slot of SLOT_VALUES){const slotItems=payload.items.filter(item=>item.slot===slot);if(!slotItems.length)continue;lines.push('## '+slot,'');for(const rarity of RARITY_VALUES){const items=slotItems.filter(item=>item.rarity===rarity);if(!items.length)continue;lines.push('### '+rarity,'','| Item ID | Arabic | English | Family | Variant | Warnings |','|---|---|---|---|---|---|',...items.map(item=>'| '+item.itemId+' | '+(item.displayNameAr||'—')+' | '+(item.displayNameEn||'—')+' | '+item.familyId+' | '+(item.variant||'—')+' | '+(item.warnings.join('; ')||'none')+' |'),'')}}
 return lines.join('\\n');
}
async function copySummary(){const payload=payloadOrAlert();if(!payload)return;const text=summaryMarkdown(payload);try{await navigator.clipboard.writeText(text);alert('Selection summary copied.')}catch{const area=document.createElement('textarea');area.value=text;document.body.append(area);area.select();document.execCommand('copy');area.remove();alert('Selection summary copied.')}}
function importPayload(payload){
 if(!payload||payload.version!=='lpc-loot-selection-v1'||!Array.isArray(payload.items))throw new Error('Unsupported or malformed selection file');
 const next=new Map();
 for(const raw of payload.items){if(!raw||typeof raw.familyId!=='string'||!familyById.has(raw.familyId))throw new Error('Unknown family ID: '+String(raw&&raw.familyId));if(next.has(raw.familyId))throw new Error('Duplicate family selection: '+raw.familyId);const f=familyById.get(raw.familyId);const base=defaultDraft(f);next.set(raw.familyId,{...base,itemId:String(raw.itemId||''),displayNameAr:String(raw.displayNameAr||''),displayNameEn:String(raw.displayNameEn||''),slot:String(raw.slot||''),rarity:String(raw.rarity||''),variant:String(raw.variant||''),bodyType:String(raw.bodyType||base.bodyType),notes:String(raw.notes||'')})}
 selection.clear();for(const [key,value] of next)selection.set(key,value);applyFilters();
}
document.getElementById('grid').addEventListener('change',event=>{const target=event.target;const card=target.closest('[data-family-id]');if(!card)return;const f=familyById.get(card.dataset.familyId);if(target.dataset.action==='select-family'){if(target.checked){const draft=defaultDraft(f);for(const input of card.querySelectorAll('[data-field]'))draft[input.dataset.field]=input.value;selection.set(f.familyId,draft)}else selection.delete(f.familyId);applyFilters();return}if(target.dataset.field&&selection.has(f.familyId)){selection.get(f.familyId)[target.dataset.field]=target.value;applyFilters()}});
document.getElementById('grid').addEventListener('input',event=>{const target=event.target;const card=target.closest('[data-family-id]');if(!card||!target.dataset.field||!selection.has(card.dataset.familyId))return;selection.get(card.dataset.familyId)[target.dataset.field]=target.value;updatePanel()});
const stats=data.stats||{};document.getElementById('summary').innerHTML=[['Logical families',stats.totalFamilies],['Curated',stats.curatedFamilies],['Technically compatible',stats.compatibleFamilies],['Partial',stats.partiallyCompatibleFamilies],['Incompatible',stats.incompatibleFamilies],['Uncertain',stats.uncertainFamilies]].map(([label,value])=>'<span><b>'+esc(value)+'</b> '+esc(label)+'</span>').join('');
for(const id of selectIds)document.getElementById(id).addEventListener('change',id==='scope'?setScopeDefaults:applyFilters);
for(const id of checkIds)document.getElementById(id).addEventListener('change',applyFilters);
document.getElementById('search').addEventListener('input',applyFilters);
document.getElementById('load-more').addEventListener('click',()=>{visibleLimit+=BATCH_SIZE;render()});
document.getElementById('export-json').addEventListener('click',()=>{const payload=payloadOrAlert();if(payload)download('lpc-loot-selection.json',JSON.stringify(payload,null,2)+'\\n','application/json')});
document.getElementById('export-csv').addEventListener('click',()=>{const payload=payloadOrAlert();if(payload)download('lpc-loot-selection.csv',payloadCsv(payload),'text/csv')});
document.getElementById('copy-summary').addEventListener('click',copySummary);
document.getElementById('clear-selection').addEventListener('click',()=>{if(selection.size&&confirm('Clear all selected loot families?')){selection.clear();applyFilters()}});
document.getElementById('import-json').addEventListener('click',()=>document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change',async event=>{const file=event.target.files&&event.target.files[0];if(!file)return;try{importPayload(JSON.parse(await file.text()));alert('Selection imported: '+selection.size+' items.')}catch(error){alert(error instanceof Error?error.message:String(error))}event.target.value=''});
window.LPC_LOOT_SELECTION_TEST_API={importPayload,selectionSize:()=>selection.size,selectionSnapshot:()=>sortedItems().map(item=>({...item})),exportPayload:()=>payloadOrAlert()};
applyFilters();
`;
}

async function writeGalleryOutputs(galleryRoot, sourceRoot, families, generatedAt, force, galleryLimit) {
  const outputNames = [
    'index.html',
    'gallery-data.json',
    'gallery-data.js',
    'loot-selection-ui.js',
    'gallery-summary.md',
  ];
  await prepareGeneratedDirectory(galleryRoot, force, outputNames, true);
  await mkdir(path.join(galleryRoot, 'thumbnails'), { recursive: true });
  const selected = [...families].sort(curatedSort).slice(0, galleryLimit);
  const thumbnailResults = new Array(selected.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(8, selected.length || 1) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selected.length) return;
      thumbnailResults[index] = await renderFamilyThumbnail(sourceRoot, galleryRoot, selected[index]);
    }
  });
  await Promise.all(workers);
  const galleryFamilies = selected.map((family, index) => ({
    familyId: family.familyId,
    label: family.label,
    currentDungeonSlot: family.currentDungeonSlot,
    libraryCategory: family.libraryCategory,
    dungeonSuitability: family.dungeonSuitability,
    dungeonSuitabilityScore: family.dungeonSuitabilityScore,
    dungeonTheme: family.dungeonTheme,
    suggestedRarity: family.suggestedRarity,
    compatibility: family.compatibility,
    availableAnimations: family.availableAnimations,
    availableBodyTypes: family.availableBodyTypes,
    availableLayers: family.availableLayers,
    availableVariants: family.availableVariants,
    idleSupport: family.idleSupport,
    walkSupport: family.walkSupport,
    hurtSupport: family.hurtSupport,
    totalFileCount: family.totalFileCount,
    totalSourceSize: family.totalSourceSize,
    sourceExample: family.sourceExample,
    sourceFiles: family.sourceFiles.map((file) => file.relativeSourcePath),
    authors: family.authors,
    licenses: family.licenses,
    warnings: sortedUnique([...family.compatibilityWarnings, ...thumbnailResults[index].warnings]),
    missingPreviews: sortedUnique(
      thumbnailResults[index].warnings
        .filter((warning) => warning.startsWith('no '))
        .map((warning) => warning.replace(/^no /, '').replace(/ preview source$/, ''))
    ),
    thumbnail: thumbnailResults[index].thumbnail,
    thumbnailBytes: thumbnailResults[index].size,
  }));
  const galleryData = {
    generatedAt,
    sourceRoot,
    previewOrder: ['idle front', 'walk front', 'idle side', 'hurt final'],
    stats: {
      totalFamilies: families.length,
      curatedFamilies: families.filter((family) =>
        ['recommended', 'acceptable'].includes(family.dungeonSuitability)
      ).length,
      compatibleFamilies: families.filter((family) => family.compatibility === 'compatible').length,
      partiallyCompatibleFamilies: families.filter(
        (family) => family.compatibility === 'partially-compatible'
      ).length,
      incompatibleFamilies: families.filter((family) => family.compatibility === 'incompatible').length,
      uncertainFamilies: families.filter((family) => family.compatibility === 'uncertain').length,
    },
    families: galleryFamilies,
  };
  const totalThumbnailBytes = thumbnailResults.reduce((total, result) => total + result.size, 0);
  await writeFile(path.join(galleryRoot, 'gallery-data.json'), JSON.stringify(galleryData, null, 2) + '\n', 'utf8');
  await writeFile(
    path.join(galleryRoot, 'gallery-data.js'),
    `window.LPC_GALLERY_DATA = ${JSON.stringify(galleryData)};\n`,
    'utf8'
  );
  await writeFile(path.join(galleryRoot, 'index.html'), lootSelectionGalleryHtml(), 'utf8');
  await writeFile(path.join(galleryRoot, 'loot-selection-ui.js'), lootSelectionGalleryScript(), 'utf8');
  await writeFile(
    path.join(galleryRoot, 'gallery-summary.md'),
    [
      '# Universal LPC Local Gallery',
      '',
      `- Logical families available: **${galleryFamilies.length}** of **${families.length}** indexed families`,
      `- Default curated scope: **${families.filter((family) => ['recommended', 'acceptable'].includes(family.dungeonSuitability)).length}**`,
      `- Technically compatible: **${families.filter((family) => family.compatibility === 'compatible').length}**`,
      `- Thumbnail files: **${thumbnailResults.length}**`,
      `- Total thumbnail bytes: **${totalThumbnailBytes.toLocaleString()}**`,
      '- Preview order: idle front, representative walk front, idle side, final hurt frame.',
      '- Every preview is extracted from source sheets and scaled 2× with nearest-neighbor.',
      '- Open `index.html` directly. Data is loaded from `gallery-data.js`; no fetch or server is used.',
      '- Loot selections remain in memory and can be exported/imported as JSON or CSV.',
      '- Use `scripts/lpc-loot-selection-exporter.mjs` to validate and normalize an exported JSON selection.',
      '',
    ].join('\n'),
    'utf8'
  );
  return { galleryFamilies, thumbnailCount: thumbnailResults.length, totalThumbnailBytes };
}

async function writeJsonStream(target, prefix, records, suffix = '\n}\n') {
  const stream = createWriteStream(target, { encoding: 'utf8' });
  stream.write(prefix);
  for (let index = 0; index < records.length; index += 1) {
    if (index > 0) stream.write(',\n');
    const canContinue = stream.write(JSON.stringify(records[index], null, 2));
    if (!canContinue) await once(stream, 'drain');
  }
  stream.end(suffix);
  await once(stream, 'finish');
}

async function prepareOutput(outRoot, force) {
  await mkdir(outRoot, { recursive: true });
  const existing = [];
  for (const fileName of OUTPUT_FILES) {
    const target = path.join(outRoot, fileName);
    if (await pathExists(target)) existing.push(target);
  }
  if (existing.length > 0 && !force) {
    throw new Error(
      `Output files already exist. Re-run with --force to replace only the eight index files:\n${existing.join('\n')}`
    );
  }
  if (force) {
    for (const target of existing) await rm(target, { force: true });
  }
}

async function validateReadableDirectory(directoryPath, label) {
  const details = await stat(directoryPath);
  if (!details.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
  const handle = await opendir(directoryPath);
  await handle.close();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const sourceRoot = path.resolve(options.source);
  const outRoot = path.resolve(options.out);
  const curatedRoot = path.resolve(options.curatedOut ?? path.join(outRoot, '..', 'lpc-library-curated'));
  const galleryRoot = path.resolve(options.galleryOut ?? path.join(outRoot, '..', 'lpc-library-gallery'));
  await validateReadableDirectory(sourceRoot, 'Source');
  for (const target of [outRoot, curatedRoot, galleryRoot]) {
    if (target === sourceRoot || target.startsWith(sourceRoot + path.sep)) {
      throw new Error('Generated output directories must not be inside the Universal LPC source directory.');
    }
  }
  await prepareOutput(outRoot, options.force);

  const scanStarted = Date.now();
  const imagePaths = [];
  let allDiscoveredCount = 0;
  for await (const absolutePath of walkFiles(sourceRoot)) {
    allDiscoveredCount += 1;
    if (IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) imagePaths.push(absolutePath);
  }
  imagePaths.sort((left, right) => toPosix(left).localeCompare(toPosix(right)));
  console.log(
    `Discovered ${allDiscoveredCount.toLocaleString()} files; indexing ${imagePaths.length.toLocaleString()} images with concurrency ${options.concurrency}.`
  );

  const { creditsPath, byPath: creditMap } = await loadCredits(sourceRoot);
  console.log(
    creditsPath
      ? `Loaded ${creditMap.size.toLocaleString()} credits records from ${creditsPath}.`
      : 'No nearby CREDITS.csv found; credits fields will remain null.'
  );

  const files = new Array(imagePaths.length);
  let nextIndex = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(options.concurrency, Math.max(1, imagePaths.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= imagePaths.length) return;
      files[index] = await inspectImage(imagePaths[index], sourceRoot, creditMap);
      completed += 1;
      if (completed % 1000 === 0 || completed === imagePaths.length) {
        const elapsedMs = Date.now() - scanStarted;
        const rate = completed / Math.max(1, elapsedMs / 1000);
        console.log(
          `[${completed.toLocaleString()}/${imagePaths.length.toLocaleString()}] elapsed ${formatElapsed(elapsedMs)}, ${rate.toFixed(1)} files/s`
        );
      }
    }
  });
  await Promise.all(workers);

  const families = buildFamilies(files, sourceRoot, creditsPath, creditMap);
  const compatibleFamilies = families.filter((family) => family.compatibility === 'compatible');
  const elapsedMs = Date.now() - scanStarted;
  const summary = summarize(files, families, allDiscoveredCount, elapsedMs);
  const scanErrors = files
    .filter((file) => file.error)
    .map((file) => ({
      absoluteSourcePath: file.absoluteSourcePath,
      relativeSourcePath: file.relativeSourcePath,
      error: file.error,
    }));

  const generatedAt = new Date().toISOString();
  await writeJsonStream(
    path.join(outRoot, 'library-files.json'),
    `{\n  "sourceRoot": ${JSON.stringify(sourceRoot)},\n  "generatedAt": ${JSON.stringify(generatedAt)},\n  "files": [\n`,
    files,
    '\n  ]\n}\n'
  );
  await writeJsonStream(
    path.join(outRoot, 'asset-families.json'),
    `{\n  "sourceRoot": ${JSON.stringify(sourceRoot)},\n  "generatedAt": ${JSON.stringify(generatedAt)},\n  "families": [\n`,
    families,
    '\n  ]\n}\n'
  );
  await writeJsonStream(
    path.join(outRoot, 'dungeon-compatible.json'),
    `{\n  "sourceRoot": ${JSON.stringify(sourceRoot)},\n  "generatedAt": ${JSON.stringify(generatedAt)},\n  "families": [\n`,
    compatibleFamilies,
    '\n  ]\n}\n'
  );
  await writeFile(path.join(outRoot, 'asset-families.csv'), familyCsv(families), 'utf8');
  await writeFile(path.join(outRoot, 'dungeon-compatible.csv'), familyCsv(compatibleFamilies), 'utf8');
  await writeFile(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await writeFile(path.join(outRoot, 'summary.md'), summaryMarkdown(summary, sourceRoot), 'utf8');
  await writeFile(
    path.join(outRoot, 'scan-errors.json'),
    JSON.stringify({ generatedAt, errors: scanErrors }, null, 2) + '\n',
    'utf8'
  );
  const curatedResult = await writeCuratedOutputs(
    curatedRoot,
    sourceRoot,
    families,
    generatedAt,
    options.force
  );
  const galleryResult = await writeGalleryOutputs(
    galleryRoot,
    sourceRoot,
    families,
    generatedAt,
    options.force,
    options.galleryLimit
  );

  console.log(
    `Indexed ${files.length.toLocaleString()} images into ${families.length.toLocaleString()} families (${compatibleFamilies.length.toLocaleString()} compatible) in ${formatElapsed(elapsedMs)}.`
  );
  console.log(`Reports written to ${outRoot}.`);
  console.log(
    `Curated ${curatedResult.curatedFamilies.length.toLocaleString()} families to ${curatedRoot}; rendered ${galleryResult.thumbnailCount.toLocaleString()} thumbnails (${galleryResult.totalThumbnailBytes.toLocaleString()} bytes) to ${galleryRoot}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
