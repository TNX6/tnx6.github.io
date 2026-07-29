export type DungeonVisualLoadout = {
  chest?: string | null;
  legs?: string | null;
  boots?: string | null;
  helmet?: string | null;
  weapon?: string | null;
  shield?: string | null;
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
};

export type DungeonLpcAdapterResult = {
  props: LpcCharacterProps;
  warnings: string[];
};

type VisualSlot = keyof LpcCharacterProps['loadout'];

export const SUPPORTED_LPC_ITEM_MAPPINGS: Readonly<
  Record<VisualSlot, readonly string[]>
> = {
  chest: ['test-armor', 'iron-armor', 'plate-armor'],
  legs: ['test-legs', 'iron-legs', 'plate-legs'],
  boots: ['test-boots', 'iron-boots', 'plate-boots'],
  helmet: ['test-helmet', 'greathelm', 'iron-helmet'],
  weapon: ['test-weapon', 'arming-sword', 'iron-sword'],
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

  const loadout = Object.fromEntries(
    VISUAL_SLOTS.map((slot) => {
      const rawItemId = input.visualLoadout?.[slot];
      const itemId =
        typeof rawItemId === 'string' ? rawItemId.trim().toLowerCase() : '';

      if (!itemId) return [slot, false];

      const supported = SUPPORTED_LPC_ITEM_MAPPINGS[slot].includes(itemId);
      if (!supported) {
        warnings.push(
          `Unsupported ${slot} item "${rawItemId}"; visual slot disabled.`,
        );
      }

      return [slot, supported];
    }),
  ) as LpcCharacterProps['loadout'];

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
    },
    warnings,
  };
};
