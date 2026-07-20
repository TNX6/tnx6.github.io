export const DUNGEON_PLAYER_ANIMATION_STATES = [
  'arriving',
  'idle',
  'entering',
  'inside',
  'returning',
  'hit',
  'dead',
  'ghost',
] as const;

export type DungeonPlayerAnimationState = (typeof DUNGEON_PLAYER_ANIMATION_STATES)[number];

interface AnimationStateElement {
  dataset: DOMStringMap;
  readonly offsetWidth: number;
}

export function setPlayerAnimationState(
  playerElement: AnimationStateElement,
  state: DungeonPlayerAnimationState,
  restart = false
): boolean {
  if (playerElement.dataset.animationState === state && !restart) return false;
  if (restart) {
    delete playerElement.dataset.animationState;
    void playerElement.offsetWidth;
  }
  playerElement.dataset.animationState = state;
  return true;
}
