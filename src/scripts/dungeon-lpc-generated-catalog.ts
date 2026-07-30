import generatedCatalogJson from '../../public/assets/dungeon-overlay/lpc-v1/generated-equipment-catalog.json';

export type GeneratedLpcSlot = 'weapon' | 'helmet' | 'armor' | 'boots';
export type GeneratedLpcVisualSlot = 'weapon' | 'helmet' | 'chest' | 'boots';
export type GeneratedLpcRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary';
export type GeneratedLpcFallbackQuality =
  | 'native'
  | 'degraded-static'
  | 'same-family-fallback'
  | 'same-slot-fallback'
  | 'generic-fallback'
  | 'blocking';

export type GeneratedLpcSimpleAssets = Readonly<{
  idle: string;
  idleBreath: string;
  walk: string;
  hurt: string;
}>;

export type GeneratedLpcSplitAssets = Readonly<{
  idle: Readonly<{ back: string; front: string }>;
  idleBreath: Readonly<{ back: string; front: string }>;
  walk: Readonly<{ back: string; front: string }>;
  hurt: Readonly<{ back: string; front: string }>;
}>;

export interface GeneratedLpcAnimationStrategy {
  readonly quality: GeneratedLpcFallbackQuality;
  readonly strategy: string;
  readonly sourceAnimation: string | null;
  readonly transformation: string | null;
  readonly donorFamilyId: string | null;
}

export interface GeneratedLpcItem {
  readonly internalItemId: string;
  readonly lpcVisualId: string;
  readonly familyId: string;
  readonly displayNameAr: string;
  readonly displayNameEn: string;
  readonly slot: GeneratedLpcSlot;
  readonly rarity: GeneratedLpcRarity;
  readonly variant: string | null;
  readonly compatibility: string;
  readonly suitability: string;
  readonly theme: string;
  readonly dropWeight: number;
  readonly isDropEligible: boolean;
  readonly isCraftOnly: boolean;
  readonly isCosmetic: boolean;
  readonly warnings: readonly string[];
  readonly animationStrategies: Readonly<{
    idle: GeneratedLpcAnimationStrategy;
    walk: GeneratedLpcAnimationStrategy;
    hurt: GeneratedLpcAnimationStrategy;
  }>;
  readonly fallbackQuality: GeneratedLpcFallbackQuality;
  readonly fallbackQualities: readonly GeneratedLpcFallbackQuality[];
  readonly layered: boolean;
  readonly assets: GeneratedLpcSimpleAssets | GeneratedLpcSplitAssets;
  readonly credits: string;
  readonly sourceManifest: string;
}

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((nested) => {
      deepFreeze(nested);
    });
  }
  return value;
};

const generatedItems = deepFreeze(
  [...(generatedCatalogJson.items as GeneratedLpcItem[])].sort((left, right) =>
    left.internalItemId.localeCompare(right.internalItemId),
  ),
);

const generatedItemsById = new Map(
  generatedItems.map((item) => [item.internalItemId, item] as const),
);

export const GENERATED_LPC_CATALOG_VERSION = generatedCatalogJson.version;

export const getAllGeneratedLpcItems = (): readonly GeneratedLpcItem[] =>
  generatedItems;

export const getGeneratedLpcItem = (
  itemId: string,
): GeneratedLpcItem | null =>
  generatedItemsById.get(itemId.trim().toLowerCase()) ?? null;

export const hasGeneratedLpcItem = (itemId: string): boolean =>
  getGeneratedLpcItem(itemId) !== null;

export const getGeneratedLpcItemsBySlot = (
  slot: GeneratedLpcSlot,
): readonly GeneratedLpcItem[] =>
  generatedItems.filter((item) => item.slot === slot);

export const resolveGeneratedLpcAssets = (
  itemId: string,
): GeneratedLpcItem['assets'] | null =>
  getGeneratedLpcItem(itemId)?.assets ?? null;

export const generatedLpcVisualSlot = (
  item: Pick<GeneratedLpcItem, 'slot'>,
): GeneratedLpcVisualSlot =>
  item.slot === 'armor' ? 'chest' : item.slot;
