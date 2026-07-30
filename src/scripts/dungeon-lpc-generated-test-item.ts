import {
  generatedLpcVisualSlot,
  getGeneratedLpcItem,
  type GeneratedLpcItem,
  type GeneratedLpcVisualSlot,
} from './dungeon-lpc-generated-catalog';

export interface DungeonLpcGeneratedTestItem {
  readonly requestedId: string;
  readonly item: GeneratedLpcItem | null;
  readonly visualSlot: GeneratedLpcVisualSlot | null;
  readonly label: string | null;
  readonly warning: string | null;
}

const LOCAL_DEVELOPMENT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

export function resolveDungeonLpcGeneratedTestItem(
  search: string,
  hostname: string,
): DungeonLpcGeneratedTestItem | null {
  if (!import.meta.env.DEV || !LOCAL_DEVELOPMENT_HOSTS.has(hostname)) {
    return null;
  }

  const params = new URLSearchParams(search);
  if (params.get('renderer') !== 'lpc') return null;

  const requestedId = params.get('lpcGeneratedItem')?.trim().toLowerCase();
  if (!requestedId) return null;

  const item = getGeneratedLpcItem(requestedId);
  if (!item) {
    return {
      requestedId,
      item: null,
      visualSlot: null,
      label: null,
      warning: `Unknown LPC generated item "${requestedId}"; real visual loadout is unchanged.`,
    };
  }

  return {
    requestedId,
    item,
    visualSlot: generatedLpcVisualSlot(item),
    label: `LPC GENERATED ITEM: ${item.internalItemId}`,
    warning: null,
  };
}
