export type DungeonRendererMode = 'equipment-v2' | 'lpc';

export function resolveDungeonRendererMode(search: string): DungeonRendererMode {
  return new URLSearchParams(search).get('renderer') === 'lpc' ? 'lpc' : 'equipment-v2';
}
