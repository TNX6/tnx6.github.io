import type { DungeonPlayerAnimationState } from './dungeon-overlay-animation-state.ts';

export const DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION = 1 as const;
export const DUNGEON_EQUIPMENT_FRAME_SIZE = 128 as const;

export const DUNGEON_EQUIPMENT_BASE_PALETTES = ['red', 'purple', 'green', 'orange', 'blue', 'black-gold'] as const;

export type DungeonEquipmentBasePalette = (typeof DUNGEON_EQUIPMENT_BASE_PALETTES)[number];

export const DUNGEON_EQUIPMENT_BASE_STATES = ['idle', 'walk-front', 'walk-back', 'death', 'ghost'] as const;
export const DUNGEON_EQUIPMENT_WEARABLE_STATES = ['idle', 'walk-front', 'walk-back'] as const;

export type DungeonEquipmentBaseState = (typeof DUNGEON_EQUIPMENT_BASE_STATES)[number];
export type DungeonEquipmentWearableState = (typeof DUNGEON_EQUIPMENT_WEARABLE_STATES)[number];

export const DUNGEON_EQUIPMENT_LAYER_ORDER = [
  'shadow',
  'weapon-back',
  'base-body',
  'boots',
  'armor',
  'helmet',
  'weapon-front',
  'effects-accent',
  'meta',
] as const;

export type DungeonEquipmentLayerName = (typeof DUNGEON_EQUIPMENT_LAYER_ORDER)[number];
export type DungeonEquipmentAssetLayer = Extract<
  DungeonEquipmentLayerName,
  'weapon-back' | 'base-body' | 'boots' | 'armor' | 'helmet' | 'weapon-front'
>;

export interface DungeonEquipmentSheetContract {
  readonly frames: number;
  readonly width: number;
  readonly height: typeof DUNGEON_EQUIPMENT_FRAME_SIZE;
  readonly durationMs: number;
  readonly loop: boolean;
}

const sheet = (frames: number, durationMs: number, loop: boolean): DungeonEquipmentSheetContract => ({
  frames,
  width: frames * DUNGEON_EQUIPMENT_FRAME_SIZE,
  height: DUNGEON_EQUIPMENT_FRAME_SIZE,
  durationMs,
  loop,
});

// Phase 6 uses one coordinate skeleton for every palette. The timings are the
// accepted red actor timings, centralized here so base and equipment never drift.
export const DUNGEON_EQUIPMENT_SHEET_CONTRACT = {
  idle: sheet(4, 960, true),
  'walk-front': sheet(6, 600, true),
  'walk-back': sheet(6, 600, true),
  death: sheet(5, 520, false),
  ghost: sheet(4, 1240, true),
} as const satisfies Record<DungeonEquipmentBaseState, DungeonEquipmentSheetContract>;

export const DUNGEON_EQUIPMENT_ANIMATION_STATE_MAP = {
  arriving: 'walk-front',
  idle: 'idle',
  entering: 'walk-back',
  inside: null,
  returning: 'walk-front',
  hit: 'idle',
  dead: 'death',
  ghost: 'ghost',
} as const satisfies Record<DungeonPlayerAnimationState, DungeonEquipmentBaseState | null>;

export interface DungeonEquipmentBaseStyle {
  readonly schemaVersion: typeof DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION;
  readonly palette: DungeonEquipmentBasePalette;
  readonly frameWidth: typeof DUNGEON_EQUIPMENT_FRAME_SIZE;
  readonly frameHeight: typeof DUNGEON_EQUIPMENT_FRAME_SIZE;
  readonly footAnchor: 120;
  readonly paths: Readonly<Record<DungeonEquipmentBaseState, string>>;
}

export interface DungeonEquipmentLayerAvailability {
  readonly back: boolean;
  readonly main: boolean;
  readonly front: boolean;
}

export type DungeonEquipmentSlot = 'weapon' | 'helmet' | 'armor' | 'boots';
export type DungeonEquipmentRarity = 'common' | 'rare';
export type DungeonEquipmentAssetPart = 'back' | 'main' | 'front';

export type DungeonEquipmentStatePaths = Readonly<Partial<Record<DungeonEquipmentAssetPart, string>>>;

export interface DungeonEquipmentAssetDefinition {
  readonly schemaVersion: typeof DUNGEON_EQUIPMENT_ASSET_SCHEMA_VERSION;
  readonly itemKey: string;
  readonly spriteKey: string;
  readonly slot: DungeonEquipmentSlot;
  readonly rarity: DungeonEquipmentRarity;
  readonly layers: DungeonEquipmentLayerAvailability;
  readonly states: readonly DungeonEquipmentWearableState[];
  readonly paths: Readonly<Record<DungeonEquipmentWearableState, DungeonEquipmentStatePaths>>;
  readonly linkedWeaponParts: boolean;
}

export interface DungeonEquipmentLoadoutVisual {
  readonly weapon: string | null;
  readonly helmet: string | null;
  readonly armor: string | null;
  readonly boots: string | null;
}

export const EMPTY_DUNGEON_EQUIPMENT_LOADOUT: DungeonEquipmentLoadoutVisual = Object.freeze({
  weapon: null,
  helmet: null,
  armor: null,
  boots: null,
});

export function equipmentLayerFor(
  slot: DungeonEquipmentSlot,
  part: DungeonEquipmentAssetPart
): DungeonEquipmentAssetLayer {
  if (slot === 'weapon') return part === 'back' ? 'weapon-back' : 'weapon-front';
  return slot;
}

export function equipmentIsVisibleInState(state: DungeonEquipmentBaseState): state is DungeonEquipmentWearableState {
  return state === 'idle' || state === 'walk-front' || state === 'walk-back';
}
