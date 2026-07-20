export const DUNGEON_CHARACTER_STYLES = ['red', 'purple', 'green', 'orange', 'blue', 'black-gold'] as const;

export type DungeonCharacterStyle = (typeof DUNGEON_CHARACTER_STYLES)[number];

interface CharacterSheetSet {
  idleSheet: string;
  walkFrontSheet: string;
  walkBackSheet: string;
  deathSheet: string;
  ghostSheet: string;
}

interface CharacterAnimationDurations {
  idle: number;
  walk: number;
  death: number;
  ghost: number;
}

export interface DungeonCharacterAnimationConfig extends CharacterSheetSet {
  frameCounts: {
    idle: 4;
    walkFront: 6;
    walkBack: 6;
    death: 5;
    ghost: 4;
  };
  durations: CharacterAnimationDurations;
  deathHoldMs: 300;
  deathMetaDrop: number;
  ghostMetaOffset: number;
  spriteScale: number;
  ghostScale: number;
  footAnchor: number;
}

const FRAME_COUNTS = {
  idle: 4,
  walkFront: 6,
  walkBack: 6,
  death: 5,
  ghost: 4,
} as const;

function sheets(style: DungeonCharacterStyle): CharacterSheetSet {
  const root = `/assets/dungeon-overlay/characters/animated/${style}/character-${style}`;
  return {
    idleSheet: `${root}-idle-sheet.webp`,
    walkFrontSheet: `${root}-walk-front-sheet.webp`,
    walkBackSheet: `${root}-walk-back-sheet.webp`,
    deathSheet: `${root}-death-sheet.webp`,
    ghostSheet: `${root}-ghost-sheet.webp`,
  };
}

export const CHARACTER_ANIMATION_CONFIG: Readonly<Record<DungeonCharacterStyle, DungeonCharacterAnimationConfig>> = {
  red: {
    ...sheets('red'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 960, walk: 600, death: 520, ghost: 1_240 },
    deathHoldMs: 300,
    deathMetaDrop: 62,
    ghostMetaOffset: -2,
    spriteScale: 1,
    ghostScale: 0.98,
    footAnchor: 120,
  },
  purple: {
    ...sheets('purple'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 1_000, walk: 620, death: 540, ghost: 1_260 },
    deathHoldMs: 300,
    deathMetaDrop: 60,
    ghostMetaOffset: -3,
    spriteScale: 1,
    ghostScale: 1,
    footAnchor: 120,
  },
  green: {
    ...sheets('green'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 920, walk: 640, death: 560, ghost: 1_320 },
    deathHoldMs: 300,
    deathMetaDrop: 64,
    ghostMetaOffset: -1,
    spriteScale: 1,
    ghostScale: 0.87,
    footAnchor: 120,
  },
  orange: {
    ...sheets('orange'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 880, walk: 560, death: 500, ghost: 1_160 },
    deathHoldMs: 300,
    deathMetaDrop: 58,
    ghostMetaOffset: -4,
    spriteScale: 1,
    ghostScale: 0.98,
    footAnchor: 120,
  },
  blue: {
    ...sheets('blue'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 1_040, walk: 580, death: 520, ghost: 1_200 },
    deathHoldMs: 300,
    deathMetaDrop: 58,
    ghostMetaOffset: -3,
    spriteScale: 1,
    ghostScale: 0.98,
    footAnchor: 120,
  },
  'black-gold': {
    ...sheets('black-gold'),
    frameCounts: FRAME_COUNTS,
    durations: { idle: 1_080, walk: 660, death: 580, ghost: 1_360 },
    deathHoldMs: 300,
    deathMetaDrop: 64,
    ghostMetaOffset: -1,
    spriteScale: 1,
    ghostScale: 0.95,
    footAnchor: 120,
  },
};
