import type { GeneratedLpcRuntimeVisualSlot } from './dungeon-lpc-generated-runtime-loader';

export interface DungeonLpcGeneratedTestItem {
  readonly requestedId: string;
  readonly visualSlot: GeneratedLpcRuntimeVisualSlot | null;
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

  const productionSlot = requestedId.match(
    /^lpc-(weapon|helmet|armor|boots)-/,
  )?.[1];
  const visualSlot =
    productionSlot === 'armor'
      ? 'chest'
      : productionSlot === 'weapon' ||
          productionSlot === 'helmet' ||
          productionSlot === 'boots'
        ? productionSlot
        : null;
  if (!visualSlot) {
    return {
      requestedId,
      visualSlot: null,
      label: null,
      warning: `Unknown LPC generated item "${requestedId}"; real visual loadout is unchanged.`,
    };
  }

  return {
    requestedId,
    visualSlot,
    label: `LPC GENERATED ITEM: ${requestedId}`,
    warning: null,
  };
}
