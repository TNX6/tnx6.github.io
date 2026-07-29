import type { DungeonViewerVisualLoadout } from './dungeon-overlay-equipment-adapter';

export type DungeonLpcTestLoadoutName = 'leather' | 'iron';

export interface DungeonLpcTestLoadout {
  readonly name: DungeonLpcTestLoadoutName;
  readonly label: string;
  readonly visualLoadout: DungeonViewerVisualLoadout;
}

export function resolveDungeonLpcTestLoadout(search: string, hostname: string): DungeonLpcTestLoadout | null {
  if (!import.meta.env.DEV) return null;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) return null;

  const params = new URLSearchParams(search);
  if (params.get('renderer') !== 'lpc') return null;

  const requested = params.get('lpcTestLoadout');
  if (requested === 'leather') {
    return {
      name: 'leather',
      label: 'LPC TEST LOADOUT: LEATHER',
      visualLoadout: {
        weapon: { spriteKey: 'rusty-sword' },
        helmet: { spriteKey: 'leather-cap' },
        armor: { spriteKey: 'patched-leather' },
        boots: { spriteKey: 'traveler-boots' },
      },
    };
  }

  if (requested === 'iron') {
    return {
      name: 'iron',
      label: 'LPC TEST LOADOUT: IRON',
      visualLoadout: {
        weapon: { spriteKey: 'steel-sword' },
        helmet: { spriteKey: 'iron-helmet' },
        armor: { spriteKey: 'iron-armor' },
        boots: { spriteKey: 'guard-boots' },
      },
    };
  }

  return null;
}
