import {
  DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION,
  DUNGEON_EQUIPMENT_BASE_PALETTES,
  DUNGEON_EQUIPMENT_FRAME_SIZE,
  DUNGEON_EQUIPMENT_WEARABLE_STATES,
  type DungeonEquipmentAssetDefinition,
  type DungeonEquipmentAssetPart,
  type DungeonEquipmentBasePalette,
  type DungeonEquipmentBaseState,
  type DungeonEquipmentBaseStyle,
  type DungeonEquipmentLayerAvailability,
  type DungeonEquipmentRarity,
  type DungeonEquipmentSlot,
} from './dungeon-equipment-asset-contract.ts';

export const DUNGEON_EQUIPMENT_PRODUCTION_ROOT = '/assets/dungeon-overlay/equipment-v2' as const;

function basePaths(palette: DungeonEquipmentBasePalette): Record<DungeonEquipmentBaseState, string> {
  const root = `${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/base/${palette}`;
  return {
    idle: `${root}/idle.webp`,
    'walk-front': `${root}/walk-front.webp`,
    'walk-back': `${root}/walk-back.webp`,
    death: `${root}/death.webp`,
    ghost: `${root}/ghost.webp`,
  };
}

export const DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST = Object.fromEntries(
  DUNGEON_EQUIPMENT_BASE_PALETTES.map((palette) => [
    palette,
    {
      schemaVersion: DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION,
      palette,
      frameWidth: DUNGEON_EQUIPMENT_FRAME_SIZE,
      frameHeight: DUNGEON_EQUIPMENT_FRAME_SIZE,
      footAnchor: 120,
      paths: basePaths(palette),
    },
  ])
) as Record<DungeonEquipmentBasePalette, DungeonEquipmentBaseStyle>;

interface EquipmentDefinitionInput {
  itemKey: string;
  spriteKey: string;
  slot: DungeonEquipmentSlot;
  rarity: DungeonEquipmentRarity;
  layers: DungeonEquipmentLayerAvailability;
  linkedWeaponParts?: boolean;
}

function equipmentDefinition(input: EquipmentDefinitionInput): DungeonEquipmentAssetDefinition {
  const root = `${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/items/${input.spriteKey}`;
  const enabledParts = (['back', 'main', 'front'] as const).filter((part) => input.layers[part]);
  const paths = Object.fromEntries(
    DUNGEON_EQUIPMENT_WEARABLE_STATES.map((state) => [
      state,
      Object.fromEntries(enabledParts.map((part) => [part, `${root}/${state}-${part}.webp`])) as Partial<
        Record<DungeonEquipmentAssetPart, string>
      >,
    ])
  ) as DungeonEquipmentAssetDefinition['paths'];

  return {
    schemaVersion: DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION,
    ...input,
    states: DUNGEON_EQUIPMENT_WEARABLE_STATES,
    paths,
    linkedWeaponParts: input.linkedWeaponParts ?? false,
  };
}

export const DUNGEON_EQUIPMENT_ASSET_MANIFEST = [
  equipmentDefinition({
    itemKey: 'dungeon.equipment.weapon.rusty_sword',
    spriteKey: 'rusty-sword',
    slot: 'weapon',
    rarity: 'common',
    layers: { back: false, main: false, front: true },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.weapon.steel_sword',
    spriteKey: 'steel-sword',
    slot: 'weapon',
    rarity: 'rare',
    layers: { back: true, main: false, front: true },
    linkedWeaponParts: true,
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.helmet.leather_cap',
    spriteKey: 'leather-cap',
    slot: 'helmet',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.helmet.iron_helmet',
    spriteKey: 'iron-helmet',
    slot: 'helmet',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.armor.patched_leather',
    spriteKey: 'patched-leather',
    slot: 'armor',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.armor.iron_armor',
    spriteKey: 'iron-armor',
    slot: 'armor',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.boots.traveler_boots',
    spriteKey: 'traveler-boots',
    slot: 'boots',
    rarity: 'common',
    layers: { back: false, main: true, front: false },
  }),
  equipmentDefinition({
    itemKey: 'dungeon.equipment.boots.guard_boots',
    spriteKey: 'guard-boots',
    slot: 'boots',
    rarity: 'rare',
    layers: { back: false, main: true, front: false },
  }),
] as const satisfies readonly DungeonEquipmentAssetDefinition[];

export const DUNGEON_EQUIPMENT_ASSET_BY_ITEM_KEY = new Map<string, DungeonEquipmentAssetDefinition>(
  DUNGEON_EQUIPMENT_ASSET_MANIFEST.map((item) => [item.itemKey, item])
);

export const DUNGEON_EQUIPMENT_ASSET_BY_SPRITE_KEY = new Map<string, DungeonEquipmentAssetDefinition>(
  DUNGEON_EQUIPMENT_ASSET_MANIFEST.map((item) => [item.spriteKey, item])
);

export function validateDungeonEquipmentManifest(
  manifest: readonly DungeonEquipmentAssetDefinition[] = DUNGEON_EQUIPMENT_ASSET_MANIFEST
): string[] {
  const errors: string[] = [];
  const itemKeys = new Set<string>();
  const spriteKeys = new Set<string>();

  manifest.forEach((item) => {
    if (itemKeys.has(item.itemKey)) errors.push(`duplicate itemKey: ${item.itemKey}`);
    if (spriteKeys.has(item.spriteKey)) errors.push(`duplicate spriteKey: ${item.spriteKey}`);
    itemKeys.add(item.itemKey);
    spriteKeys.add(item.spriteKey);

    if (!/^[a-z0-9]+(?:[.-][a-z0-9_]+)*$/.test(item.itemKey)) errors.push(`invalid itemKey: ${item.itemKey}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.spriteKey)) errors.push(`invalid spriteKey: ${item.spriteKey}`);
    if (item.slot === 'weapon' && (!item.layers.front || item.layers.main)) {
      errors.push(`invalid weapon layer combination: ${item.spriteKey}`);
    }
    if (item.slot !== 'weapon' && (!item.layers.main || item.layers.back || item.layers.front)) {
      errors.push(`invalid ${item.slot} layer combination: ${item.spriteKey}`);
    }
    Object.values(item.paths).forEach((statePaths) => {
      Object.values(statePaths).forEach((path) => {
        if (!path || path.includes('..') || !path.startsWith(`${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/items/`)) {
          errors.push(`unsafe asset path: ${path ?? '<missing>'}`);
        }
      });
    });
  });

  return errors;
}
