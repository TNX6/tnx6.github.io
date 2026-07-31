export type GeneratedLpcRuntimeSlot = 'weapon' | 'helmet' | 'armor' | 'boots';
export type GeneratedLpcRuntimeVisualSlot = 'weapon' | 'helmet' | 'chest' | 'boots';

export type GeneratedLpcRuntimeSimpleAsset = string;
export type GeneratedLpcRuntimeSplitAsset = Readonly<{
  back: string;
  front: string;
}>;
export type GeneratedLpcRuntimeAsset = GeneratedLpcRuntimeSimpleAsset | GeneratedLpcRuntimeSplitAsset;

export interface GeneratedLpcRuntimeItem {
  readonly internalItemId: string;
  readonly lpcVisualId: string;
  readonly slot: GeneratedLpcRuntimeSlot;
  readonly layered: boolean;
  readonly idle: GeneratedLpcRuntimeAsset;
  readonly walk: GeneratedLpcRuntimeAsset;
  readonly hurt: GeneratedLpcRuntimeAsset;
  readonly idleBreath: GeneratedLpcRuntimeAsset;
}

const RUNTIME_MAP_URLS = Object.freeze({
  weapon: '/assets/dungeon-overlay/lpc-v1/runtime/generated-weapon-map.json',
  helmet: '/assets/dungeon-overlay/lpc-v1/runtime/generated-helmet-map.json',
  armor: '/assets/dungeon-overlay/lpc-v1/runtime/generated-armor-map.json',
  boots: '/assets/dungeon-overlay/lpc-v1/runtime/generated-boots-map.json',
} satisfies Record<GeneratedLpcRuntimeSlot, string>);

const runtimeMaps = new Map<GeneratedLpcRuntimeSlot, ReadonlyMap<string, GeneratedLpcRuntimeItem> | null>();
const runtimeMapPromises = new Map<
  GeneratedLpcRuntimeSlot,
  Promise<ReadonlyMap<string, GeneratedLpcRuntimeItem> | null>
>();
const runtimeMapControllers = new Map<GeneratedLpcRuntimeSlot, AbortController>();
const warnedMapFailures = new Set<GeneratedLpcRuntimeSlot>();

const VISUAL_CATEGORIES_BY_SLOT = Object.freeze({
  weapon: ['weapon', 'shield', 'tools', 'quiver'],
  helmet: ['helmet', 'hat', 'hair', 'head', 'facial', 'eyes', 'beards'],
  armor: ['armor', 'torso', 'body', 'neck', 'dress', 'backpack', 'arms', 'shoulders', 'cape', 'shadow'],
  boots: ['boots', 'legs', 'feet'],
} satisfies Record<GeneratedLpcRuntimeSlot, readonly string[]>);

const SLOT_BY_VISUAL_CATEGORY = new Map<string, GeneratedLpcRuntimeSlot>(
  Object.entries(VISUAL_CATEGORIES_BY_SLOT).flatMap(([slot, categories]) =>
    categories.map((category) => [category, slot as GeneratedLpcRuntimeSlot] as const)
  )
);

const runtimeSlotForIdentity = (itemId: string): GeneratedLpcRuntimeSlot | null => {
  const normalizedId = itemId.trim().toLowerCase();
  const internalSlot = /^lpc-(weapon|helmet|armor|boots)-[a-z0-9][a-z0-9-]*$/.exec(normalizedId)?.[1] as
    | GeneratedLpcRuntimeSlot
    | undefined;
  if (internalSlot) return internalSlot;

  const visualCategory = /^lpc-visual-([a-z0-9]+)-[a-z0-9][a-z0-9-]*$/.exec(normalizedId)?.[1];
  return visualCategory ? (SLOT_BY_VISUAL_CATEGORY.get(visualCategory) ?? null) : null;
};

const isSplitAsset = (value: unknown): value is GeneratedLpcRuntimeSplitAsset =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { back?: unknown }).back === 'string' &&
      typeof (value as { front?: unknown }).front === 'string'
  );

const isAsset = (value: unknown): value is GeneratedLpcRuntimeAsset => typeof value === 'string' || isSplitAsset(value);

const isRuntimeItem = (value: unknown, slot: GeneratedLpcRuntimeSlot): value is GeneratedLpcRuntimeItem => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<GeneratedLpcRuntimeItem>;
  return (
    typeof item.internalItemId === 'string' &&
    typeof item.lpcVisualId === 'string' &&
    item.slot === slot &&
    runtimeSlotForIdentity(item.internalItemId) === slot &&
    runtimeSlotForIdentity(item.lpcVisualId) === slot &&
    typeof item.layered === 'boolean' &&
    isAsset(item.idle) &&
    isAsset(item.walk) &&
    isAsset(item.hurt) &&
    isAsset(item.idleBreath)
  );
};

const warnMapFailure = (slot: GeneratedLpcRuntimeSlot, error: unknown): void => {
  if (warnedMapFailures.has(slot)) return;
  warnedMapFailures.add(slot);
  console.warn(`[LPC V1] Failed to load generated ${slot} runtime map; that visual slot is disabled.`, error);
};

const loadRuntimeMap = (
  slot: GeneratedLpcRuntimeSlot
): Promise<ReadonlyMap<string, GeneratedLpcRuntimeItem> | null> => {
  if (runtimeMaps.has(slot)) {
    return Promise.resolve(runtimeMaps.get(slot) ?? null);
  }

  const existingPromise = runtimeMapPromises.get(slot);
  if (existingPromise) return existingPromise;

  const controller = new AbortController();
  runtimeMapControllers.set(slot, controller);
  const promise = fetch(RUNTIME_MAP_URLS[slot], {
    cache: 'force-cache',
    credentials: 'same-origin',
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${response.url}`);
      }
      const parsed: unknown = await response.json();
      if (!Array.isArray(parsed)) {
        throw new TypeError(`Generated ${slot} runtime map is not an array.`);
      }
      const invalidIndex = parsed.findIndex((item) => !isRuntimeItem(item, slot));
      if (invalidIndex !== -1) {
        throw new TypeError(`Generated ${slot} runtime map has an invalid item at index ${invalidIndex}.`);
      }
      const map = new Map<string, GeneratedLpcRuntimeItem>();
      parsed.forEach((item) => {
        const identities = [item.internalItemId, item.lpcVisualId];
        identities.forEach((identity) => {
          const normalizedIdentity = identity.trim().toLowerCase();
          const existing = map.get(normalizedIdentity);
          if (existing && existing !== item) {
            throw new TypeError(`Generated ${slot} runtime map has an identity collision for ${normalizedIdentity}.`);
          }
          map.set(normalizedIdentity, item);
        });
      });
      runtimeMaps.set(slot, map);
      return map;
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted) warnMapFailure(slot, error);
      runtimeMaps.set(slot, null);
      return null;
    })
    .finally(() => {
      runtimeMapControllers.delete(slot);
    });

  runtimeMapPromises.set(slot, promise);
  return promise;
};

export const generatedLpcRuntimeVisualSlot = (slot: GeneratedLpcRuntimeSlot): GeneratedLpcRuntimeVisualSlot =>
  slot === 'armor' ? 'chest' : slot;

export const generatedLpcRuntimeSlotFor = (visualSlot: string, itemId: string): GeneratedLpcRuntimeSlot | null => {
  const normalizedId = itemId.trim().toLowerCase();
  const expectedSlot =
    visualSlot === 'chest'
      ? 'armor'
      : visualSlot === 'weapon' || visualSlot === 'helmet' || visualSlot === 'boots'
        ? visualSlot
        : null;
  const identitySlot = runtimeSlotForIdentity(normalizedId);
  return expectedSlot && identitySlot === expectedSlot ? expectedSlot : null;
};

export const loadGeneratedLpcRuntimeItem = async (
  slot: GeneratedLpcRuntimeSlot,
  itemId: string
): Promise<GeneratedLpcRuntimeItem | null> => {
  if (runtimeSlotForIdentity(itemId) !== slot) return null;
  const runtimeMap = await loadRuntimeMap(slot);
  return runtimeMap?.get(itemId.trim().toLowerCase()) ?? null;
};

export const clearGeneratedLpcRuntimeMapCache = (): void => {
  runtimeMapControllers.forEach((controller) => controller.abort());
  runtimeMapControllers.clear();
  runtimeMapPromises.clear();
  runtimeMaps.clear();
  warnedMapFailures.clear();
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', clearGeneratedLpcRuntimeMapCache, {
    once: true,
  });
}
