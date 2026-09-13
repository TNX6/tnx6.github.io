export type DungeonRendererMode = 'equipment-v2' | 'lpc';

export function resolveDungeonRendererMode(search: string): DungeonRendererMode {
  return new URLSearchParams(search).get('renderer') === 'equipment-v2' ? 'equipment-v2' : 'lpc';
}
