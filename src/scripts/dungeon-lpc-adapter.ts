import {
  generatedLpcVisualSlot,
  getGeneratedLpcItem,
} from './dungeon-lpc-generated-catalog';

export type DungeonVisualItem =
  | string
  | { readonly spriteKey: string };

export type DungeonVisualLoadout = {
  chest?: DungeonVisualItem | null;
  armor?: DungeonVisualItem | null;
  legs?: DungeonVisualItem | null;
  boots?: DungeonVisualItem | null;
  helmet?: DungeonVisualItem | null;
  weapon?: DungeonVisualItem | null;
  shield?: DungeonVisualItem | null;
};

export type DungeonPlayerInput = {
  slot: number;
  twitchUserId?: string;
  username: string;
  displayName?: string;
  level?: number;
  status?: string;
  animationState?: string;
  direction?: string;
  visualLoadout?: DungeonVisualLoadout;
};

export type DungeonPlayerPatch = Partial<
  Omit<DungeonPlayerInput, 'visualLoadout'>
> & {
  visualLoadout?: DungeonVisualLoadout | null;
};

export type LpcCharacterProps = {
  name: string;
  level: number;
  state: 'idle' | 'walk' | 'hurt';
  direction: 'front' | 'back' | 'left' | 'right';
  scale: number;
  showName: boolean;
  showLevel: boolean;
  loadout: {
    chest: boolean;
    legs: boolean;
    boots: boolean;
    helmet: boolean;
    weapon: boolean;
    shield: boolean;
  };
  itemIds: {
    chest: string | null;
    legs: string | null;
    boots: string | null;
    helmet: string | null;
    weapon: string | null;
    shield: string | null;
  };
};

export type DungeonLpcAdapterResult = {
  props: LpcCharacterProps;
  warnings: string[];
};

type VisualSlot = keyof LpcCharacterProps['loadout'];

export const SUPPORTED_LPC_ITEM_MAPPINGS: Readonly<
  Record<VisualSlot, readonly string[]>
> = {
  chest: ['test-armor', 'patched-leather', 'iron-armor', 'plate-armor'],
  legs: ['test-legs', 'iron-legs', 'plate-legs'],
  boots: [
    'test-boots',
    'leather-boots',
    'guard-boots',
    'iron-boots',
    'plate-boots',
  ],
  helmet: ['test-helmet', 'leather-cap', 'greathelm', 'iron-helmet'],
  weapon: [
    'test-weapon',
    'rusty-sword',
    'steel-sword',
    'arming-sword',
    'iron-sword',
  ],
  shield: ['test-shield', 'heater-shield', 'iron-shield'],
};

const VISUAL_SLOTS = [
  'chest',
  'legs',
  'boots',
  'helmet',
  'weapon',
  'shield',
] as const satisfies readonly VisualSlot[];

const normalizedText = (value: string | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const mapState = (value: string | undefined): LpcCharacterProps['state'] => {
  switch (normalizedText(value).toLowerCase()) {
    case 'walking':
    case 'walk':
      return 'walk';
    case 'damaged':
    case 'downed':
    case 'hurt':
    case 'defeated':
      return 'hurt';
    case 'idle':
    default:
      return 'idle';
  }
};

const mapDirection = (
  value: string | undefined,
): LpcCharacterProps['direction'] => {
  switch (normalizedText(value).toLowerCase()) {
    case 'back':
    case 'up':
      return 'back';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'front':
    case 'down':
    default:
      return 'front';
  }
};

export const adaptDungeonPlayerToLpc = (
  input: DungeonPlayerInput,
): DungeonLpcAdapterResult => {
  const warnings: string[] = [];
  const displayName = normalizedText(input.displayName);
  const username = normalizedText(input.username);

  const loadout = {} as LpcCharacterProps['loadout'];
  const itemIds = {} as LpcCharacterProps['itemIds'];

  VISUAL_SLOTS.forEach((slot) => {
    const rawItem =
      slot === 'chest'
        ? input.visualLoadout?.chest ?? input.visualLoadout?.armor
        : input.visualLoadout?.[slot];
    const rawItemId =
      typeof rawItem === 'string'
        ? rawItem
        : rawItem &&
            typeof rawItem === 'object' &&
            typeof rawItem.spriteKey === 'string'
          ? rawItem.spriteKey
          : '';
    const normalizedItemId = rawItemId.trim().toLowerCase();
    const itemId =
      slot === 'boots' && normalizedItemId === 'traveler-boots'
        ? 'leather-boots'
        : normalizedItemId;

    if (!itemId) {
      loadout[slot] = false;
      itemIds[slot] = null;
      return;
    }

    const directlySupported =
      SUPPORTED_LPC_ITEM_MAPPINGS[slot].includes(itemId);
    const generatedItem = directlySupported
      ? null
      : getGeneratedLpcItem(itemId);
    const generatedSupported =
      generatedItem !== null &&
      generatedLpcVisualSlot(generatedItem) === slot;
    const supported = directlySupported || generatedSupported;
    if (!supported) {
      warnings.push(
        `Unsupported ${slot} item "${rawItemId}"; visual slot disabled.`,
      );
    }

    loadout[slot] = supported;
    itemIds[slot] = supported ? itemId : null;
  });

  return {
    props: {
      name: displayName || username || 'Unknown Player',
      level:
        Number.isInteger(input.level) && Number(input.level) > 0
          ? Number(input.level)
          : 1,
      state: mapState(input.animationState),
      direction: mapDirection(input.direction),
      scale: 3,
      showName: false,
      showLevel: false,
      loadout,
      itemIds,
    },
    warnings,
  };
};
