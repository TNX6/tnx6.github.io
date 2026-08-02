import equipmentCatalog from '../../public/assets/dungeon-overlay/lpc-v1/equipment-catalog.json';
import '../styles/dungeon-lpc-renderer.css';
import {
  adaptDungeonPlayerToLpc,
  type DungeonPlayerInput,
  type DungeonPlayerPatch,
  type LpcCharacterProps,
} from './dungeon-lpc-adapter';
import {
  generatedLpcRuntimeItemMatchesIdentity,
  generatedLpcRuntimeSlotFor,
  generatedLpcRuntimeVisualSlot,
  resolveGeneratedLpcRuntimeEntry,
  type GeneratedLpcRuntimeItem,
} from './dungeon-lpc-generated-runtime-loader';

type VisualSlot = keyof LpcCharacterProps['loadout'];
type LayerKey =
  | 'weapon-back'
  | 'shield-back'
  | 'base'
  | 'legs'
  | 'boots'
  | 'chest'
  | 'weapon-front'
  | 'shield-front'
  | 'helmet';

type SimpleAssets = {
  idle: string;
  idleBreath?: string;
  walk: string;
  hurt?: string;
};

type SplitAssets = {
  idle: { back: string; front: string };
  idleBreath?: { back?: string; front?: string };
  walk: { back: string; front: string };
  hurt?: { back?: string; front?: string };
};

type CatalogItem = {
  id: string;
  slot: VisualSlot;
  assets: SimpleAssets | SplitAssets;
};

type LayerDefinition = {
  key: LayerKey;
  slot?: VisualSlot;
  classes: string[];
  idle: string;
  idleBreath?: string;
  walk: string;
  hurt?: string;
};

const ANIMATION_STATE_CLASSES = [
  'is-idle-frame',
  'is-idle-breath-animation',
  'is-walk-animation',
  'is-hurt-animation',
  'is-hurt-unsupported',
] as const;

const LPC_IDLE_BREATH_DELAYS = [0, -350, -700, -1050, -1400, -1750] as const;

export type LpcCharacterInstance = {
  root: HTMLElement;
  input: DungeonPlayerInput;
  currentInput: DungeonPlayerInput;
  props: LpcCharacterProps;
  warnings: string[];
  update(patch: DungeonPlayerPatch): void;
  destroy(): void;
};

const BASE_ASSETS = {
  idle: '/assets/dungeon-overlay/lpc-v1/base/male/idle.png',
  idleBreath: '/assets/dungeon-overlay/lpc-v1/base/male/idle-breathe-v1.png',
  walk: '/assets/dungeon-overlay/lpc-v1/base/male/walk.png',
  hurt: '/assets/dungeon-overlay/lpc-v1/base/male/hurt.png',
} as const;

// Keep shield paths explicit in the runtime bundle. The unique Crusader V3
// filenames prevent any heater asset or cached generic test-shield fallback.
const SHIELD_ASSETS = {
  idle: {
    back: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-idle-back-v3.png',
    front: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-idle-front-v3.png',
  },
  idleBreath: {
    back:
      '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-idle-breathe-back-v1.png',
    front:
      '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-idle-breathe-front-v1.png',
  },
  walk: {
    back: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-walk-back-v3.png',
    front: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-walk-front-v3.png',
  },
  hurt: {
    back: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-hurt-back-v3.png',
    front: '/assets/dungeon-overlay/lpc-v1/equipment/test-shield/crusader-hurt-front-v3.png',
  },
} satisfies SplitAssets;

const DEFAULT_ITEM_ID_BY_SLOT = Object.freeze({
  chest: 'test-armor',
  legs: 'test-legs',
  boots: 'test-boots',
  helmet: 'test-helmet',
  weapon: 'test-weapon',
  shield: 'test-shield',
} satisfies Record<VisualSlot, string>);

const equipmentById = new Map(
  (equipmentCatalog.items as CatalogItem[]).map((item) => [item.id, item]),
);

const catalogItemFromGenerated = (
  slot: VisualSlot,
  item: GeneratedLpcRuntimeItem | undefined,
): CatalogItem | null => {
  if (!item || generatedLpcRuntimeVisualSlot(item.slot) !== slot) return null;
  const assets = item.layered
    ? {
        idle: item.idle,
        idleBreath: item.idleBreath,
        walk: item.walk,
        hurt: item.hurt,
      }
    : {
        idle: item.idle,
        idleBreath: item.idleBreath,
        walk: item.walk,
        hurt: item.hurt,
      };
  return {
    id: item.internalItemId,
    slot,
    assets: assets as SimpleAssets | SplitAssets,
  };
};

const catalogItemFor = (
  slot: VisualSlot,
  itemId: string | null,
  generatedItem?: GeneratedLpcRuntimeItem,
): CatalogItem => {
  const selected = itemId ? equipmentById.get(itemId) : undefined;
  if (selected?.slot === slot) return selected;
  const generated = catalogItemFromGenerated(slot, generatedItem);
  if (generated && generatedLpcRuntimeItemMatchesIdentity(generatedItem, itemId)) return generated;
  const fallback = equipmentById.get(DEFAULT_ITEM_ID_BY_SLOT[slot]);
  if (!fallback || fallback.slot !== slot) {
    throw new Error(`Missing LPC catalog fallback for ${slot}.`);
  }
  return fallback;
};

const simpleAssets = (
  slot: Exclude<VisualSlot, 'weapon' | 'shield'>,
  itemId: string | null = null,
): SimpleAssets => catalogItemFor(slot, itemId).assets as SimpleAssets;

const splitAssets = (
  slot: 'weapon' | 'shield',
  itemId: string | null = null,
): SplitAssets => catalogItemFor(slot, itemId).assets as SplitAssets;

const chestAssets = simpleAssets('chest');
const legsAssets = simpleAssets('legs');
const bootsAssets = simpleAssets('boots');
const helmetAssets = simpleAssets('helmet');
const weaponAssets = splitAssets('weapon');
const shieldAssets = SHIELD_ASSETS;

// Preserve the canonical LPC ascending zPos order: shield bg (2-6),
// weapon bg (9), body/equipment, shield fg (110-115), weapon fg (140).
const LAYER_DEFINITIONS: LayerDefinition[] = [
  {
    key: 'shield-back',
    slot: 'shield',
    classes: ['lpc-runtime-equipment-layer', 'slot-shield', 'layer-back'],
    idle: shieldAssets.idle.back,
    idleBreath: shieldAssets.idleBreath?.back,
    walk: shieldAssets.walk.back,
    hurt: shieldAssets.hurt?.back,
  },
  {
    key: 'weapon-back',
    slot: 'weapon',
    classes: ['lpc-runtime-equipment-layer', 'slot-weapon', 'layer-back'],
    idle: weaponAssets.idle.back,
    idleBreath: weaponAssets.idleBreath?.back,
    walk: weaponAssets.walk.back,
    hurt: weaponAssets.hurt?.back,
  },
  {
    key: 'base',
    classes: ['lpc-runtime-base-layer'],
    idle: BASE_ASSETS.idle,
    idleBreath: BASE_ASSETS.idleBreath,
    walk: BASE_ASSETS.walk,
    hurt: BASE_ASSETS.hurt,
  },
  {
    key: 'legs',
    slot: 'legs',
    classes: ['lpc-runtime-equipment-layer', 'slot-legs'],
    idle: legsAssets.idle,
    idleBreath: legsAssets.idleBreath,
    walk: legsAssets.walk,
    hurt: legsAssets.hurt,
  },
  {
    key: 'boots',
    slot: 'boots',
    classes: ['lpc-runtime-equipment-layer', 'slot-boots'],
    idle: bootsAssets.idle,
    idleBreath: bootsAssets.idleBreath,
    walk: bootsAssets.walk,
    hurt: bootsAssets.hurt,
  },
  {
    key: 'chest',
    slot: 'chest',
    classes: ['lpc-runtime-equipment-layer', 'slot-chest'],
    idle: chestAssets.idle,
    idleBreath: chestAssets.idleBreath,
    walk: chestAssets.walk,
    hurt: chestAssets.hurt,
  },
  {
    key: 'shield-front',
    slot: 'shield',
    classes: ['lpc-runtime-equipment-layer', 'slot-shield', 'layer-front'],
    idle: shieldAssets.idle.front,
    idleBreath: shieldAssets.idleBreath?.front,
    walk: shieldAssets.walk.front,
    hurt: shieldAssets.hurt?.front,
  },
  {
    key: 'weapon-front',
    slot: 'weapon',
    classes: ['lpc-runtime-equipment-layer', 'slot-weapon', 'layer-front'],
    idle: weaponAssets.idle.front,
    idleBreath: weaponAssets.idleBreath?.front,
    walk: weaponAssets.walk.front,
    hurt: weaponAssets.hurt?.front,
  },
  {
    key: 'helmet',
    slot: 'helmet',
    classes: ['lpc-runtime-equipment-layer', 'slot-helmet'],
    idle: helmetAssets.idle,
    idleBreath: helmetAssets.idleBreath,
    walk: helmetAssets.walk,
    hurt: helmetAssets.hurt,
  },
];

const warnedIdleBreathLayers = new Set<LayerKey>();

const warnMissingIdleBreath = (definition: LayerDefinition): void => {
  if (!import.meta.env.DEV || warnedIdleBreathLayers.has(definition.key)) return;
  warnedIdleBreathLayers.add(definition.key);
  console.warn(
    `[LPC V1] ${definition.key} has no idleBreath asset; keeping its normal idle frame static.`,
  );
};

const loadoutChanged = (
  previous: LpcCharacterProps,
  next: LpcCharacterProps,
): boolean =>
  (Object.keys(previous.loadout) as VisualSlot[]).some(
    (slot) =>
      previous.loadout[slot] !== next.loadout[slot] ||
      previous.itemIds[slot] !== next.itemIds[slot],
  );

const setImageVariable = (
  element: HTMLElement,
  name: string,
  path: string,
): void => {
  element.style.setProperty(name, `url("${path}")`);
};

const assetsForEquipmentLayer = (
  definition: LayerDefinition,
  itemIds: LpcCharacterProps['itemIds'],
  generatedItems: Partial<Record<VisualSlot, GeneratedLpcRuntimeItem>>,
): LayerDefinition => {
  const slot = definition.slot;
  if (!slot) return definition;
  const itemId = itemIds[slot];
  const item = catalogItemFor(slot, itemId, generatedItems[slot]);

  if (slot === 'weapon' || slot === 'shield') {
    const assets =
      slot === 'shield' && item.id === 'test-shield'
        ? SHIELD_ASSETS
        : (item.assets as SplitAssets);
    const part = definition.key.endsWith('-back') ? 'back' : 'front';
    return {
      ...definition,
      idle: assets.idle[part],
      idleBreath: assets.idleBreath?.[part],
      walk: assets.walk[part],
      hurt: assets.hurt?.[part],
    };
  }

  const assets = item.assets as SimpleAssets;
  return {
    ...definition,
    idle: assets.idle,
    idleBreath: assets.idleBreath,
    walk: assets.walk,
    hurt: assets.hurt,
  };
};

const slotSupportsHurt = (
  slot: VisualSlot,
  itemId: string | null,
  generatedItem?: GeneratedLpcRuntimeItem,
): boolean => {
  const item = catalogItemFor(slot, itemId, generatedItem);
  if (slot === 'weapon' || slot === 'shield') {
    const assets =
      slot === 'shield' && item.id === 'test-shield'
        ? SHIELD_ASSETS
        : (item.assets as SplitAssets);
    return Boolean(assets.hurt?.back || assets.hurt?.front);
  }
  return Boolean((item.assets as SimpleAssets).hurt);
};

const mergePlayerPatch = (
  currentInput: DungeonPlayerInput,
  patch: DungeonPlayerPatch,
): DungeonPlayerInput => {
  const { visualLoadout: loadoutPatch, ...topLevelPatch } = patch;
  const mergedPlayer: DungeonPlayerInput = {
    ...currentInput,
    ...topLevelPatch,
  };

  if (loadoutPatch === undefined) {
    mergedPlayer.visualLoadout = currentInput.visualLoadout;
  } else if (loadoutPatch === null) {
    delete mergedPlayer.visualLoadout;
  } else {
    mergedPlayer.visualLoadout = {
      ...currentInput.visualLoadout,
      ...loadoutPatch,
    };
  }

  return mergedPlayer;
};

const idleBreathDelayForSlot = (slot: number): number =>
  LPC_IDLE_BREATH_DELAYS[
    Number.isInteger(slot) && slot >= 1 && slot <= LPC_IDLE_BREATH_DELAYS.length
      ? slot - 1
      : 0
  ];

export const createLpcCharacter = (
  container: HTMLElement,
  initialPlayer: DungeonPlayerInput,
): LpcCharacterInstance => {
  const root = document.createElement('article');
  root.className = 'lpc-runtime-character';
  root.dataset.lpcRuntimeCharacter = '';

  const visual = document.createElement('div');
  visual.className = 'lpc-runtime-visual';
  visual.setAttribute('aria-hidden', 'true');

  const stack = document.createElement('div');
  stack.className = 'lpc-runtime-stack';
  visual.append(stack);

  const layerElements = new Map<LayerKey, HTMLElement>();
  const equipmentElements: Record<VisualSlot, HTMLElement[]> = {
    chest: [],
    legs: [],
    boots: [],
    helmet: [],
    weapon: [],
    shield: [],
  };

  LAYER_DEFINITIONS.forEach((definition) => {
    const layer = document.createElement('div');
    layer.classList.add('lpc-runtime-layer', ...definition.classes);
    layer.dataset.layer = definition.key;
    setImageVariable(layer, '--lpc-idle-image', definition.idle);
    if (definition.idleBreath) {
      setImageVariable(layer, '--lpc-idle-breath-image', definition.idleBreath);
      layer.classList.add('has-idle-breath-layer');
    }
    setImageVariable(layer, '--lpc-walk-image', definition.walk);
    if (definition.hurt) {
      setImageVariable(layer, '--lpc-hurt-image', definition.hurt);
      layer.classList.add('has-hurt-layer');
    }
    stack.append(layer);
    layerElements.set(definition.key, layer);
    if (definition.slot) equipmentElements[definition.slot].push(layer);
  });

  const meta = document.createElement('div');
  meta.className = 'lpc-runtime-meta';

  const nameElement = document.createElement('h3');
  nameElement.className = 'lpc-runtime-name';

  const facts = document.createElement('div');
  facts.className = 'lpc-runtime-facts';

  const levelElement = document.createElement('span');
  const stateElement = document.createElement('span');
  const directionElement = document.createElement('span');
  const updateElement = document.createElement('span');
  updateElement.className = 'lpc-runtime-update-count';
  facts.append(levelElement, stateElement, directionElement, updateElement);

  const warningsElement = document.createElement('ul');
  warningsElement.className = 'lpc-runtime-warnings';
  warningsElement.hidden = true;

  meta.append(nameElement, facts, warningsElement);
  root.append(visual, meta);

  let destroyed = false;
  let updateCount = 0;
  const disposers: Array<() => void> = [];
  const initialResult = adaptDungeonPlayerToLpc(initialPlayer);
  let mappedProps = initialResult.props;
  let mappedWarnings = [...initialResult.warnings];
  const resolvedGeneratedItems: Partial<
    Record<VisualSlot, GeneratedLpcRuntimeItem>
  > = {};
  const requestedGeneratedIds: Partial<Record<VisualSlot, string>> = {};
  const generatedWarnings: Partial<Record<VisualSlot, string>> = {};
  const generatedResolutionTokens: Record<VisualSlot, number> = {
    chest: 0,
    legs: 0,
    boots: 0,
    helmet: 0,
    weapon: 0,
    shield: 0,
  };

  const effectiveProps = (): LpcCharacterProps => {
    const loadout = { ...mappedProps.loadout };
    (Object.keys(resolvedGeneratedItems) as VisualSlot[]).forEach((slot) => {
      const item = resolvedGeneratedItems[slot];
      if (generatedLpcRuntimeItemMatchesIdentity(item, mappedProps.itemIds[slot])) {
        loadout[slot] = true;
      }
    });
    return { ...mappedProps, loadout };
  };

  const effectiveWarnings = (): string[] => [
    ...mappedWarnings,
    ...(Object.keys(generatedWarnings) as VisualSlot[])
      .map((slot) => generatedWarnings[slot])
      .filter((warning): warning is string => Boolean(warning)),
  ];

  const instance: LpcCharacterInstance = {
    root,
    input: initialPlayer,
    currentInput: initialPlayer,
    props: effectiveProps(),
    warnings: effectiveWarnings(),
    update(patch) {
      if (destroyed) {
        throw new Error('Cannot update a destroyed LPC character instance.');
      }

      const previousProps = instance.props;
      const mergedPlayer = mergePlayerPatch(instance.currentInput, patch);
      const nextResult = adaptDungeonPlayerToLpc(mergedPlayer);
      mappedProps = nextResult.props;
      mappedWarnings = [...nextResult.warnings];
      synchronizeGeneratedRequests();
      const nextProps = effectiveProps();
      const restartAnimation =
        previousProps.state !== nextProps.state ||
        previousProps.direction !== nextProps.direction ||
        loadoutChanged(previousProps, nextProps);

      instance.input = mergedPlayer;
      instance.currentInput = mergedPlayer;
      instance.props = nextProps;
      instance.warnings = effectiveWarnings();
      updateCount += 1;
      renderMappedState(restartAnimation);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      (Object.keys(generatedResolutionTokens) as VisualSlot[]).forEach(
        (slot) => {
          generatedResolutionTokens[slot] += 1;
          delete requestedGeneratedIds[slot];
          delete resolvedGeneratedItems[slot];
          delete generatedWarnings[slot];
        },
      );
      disposers.splice(0).forEach((dispose) => dispose());
      root.replaceChildren();
      root.remove();
      layerElements.clear();
    },
  };

  function synchronizeGeneratedRequests(): void {
    (
      Object.keys(generatedResolutionTokens) as VisualSlot[]
    ).forEach((slot) => {
      const itemId = mappedProps.itemIds[slot];
      const runtimeSlot = itemId
        ? generatedLpcRuntimeSlotFor(slot, itemId)
        : null;

      if (!itemId || !runtimeSlot) {
        if (
          requestedGeneratedIds[slot] ||
          resolvedGeneratedItems[slot] ||
          generatedWarnings[slot]
        ) {
          generatedResolutionTokens[slot] += 1;
          delete requestedGeneratedIds[slot];
          delete resolvedGeneratedItems[slot];
          delete generatedWarnings[slot];
        }
        return;
      }

      if (requestedGeneratedIds[slot] === itemId) return;

      generatedResolutionTokens[slot] += 1;
      const token = generatedResolutionTokens[slot];
      requestedGeneratedIds[slot] = itemId;
      delete resolvedGeneratedItems[slot];
      delete generatedWarnings[slot];

      void resolveGeneratedLpcRuntimeEntry(itemId, runtimeSlot).then((item) => {
        if (
          destroyed ||
          token !== generatedResolutionTokens[slot] ||
          mappedProps.itemIds[slot] !== itemId
        ) {
          return;
        }

        if (item) {
          resolvedGeneratedItems[slot] = item;
          delete generatedWarnings[slot];
        } else {
          delete resolvedGeneratedItems[slot];
          generatedWarnings[slot] =
            `Unsupported generated ${runtimeSlot} item "${itemId}"; visual slot disabled.`;
        }

        const previousProps = instance.props;
        instance.props = effectiveProps();
        instance.warnings = effectiveWarnings();
        renderMappedState(loadoutChanged(previousProps, instance.props));
      });
    });
  }

  const renderMappedState = (restartAnimation: boolean): void => {
    const { props, warnings } = instance;

    // Disable the previous animation before changing any layer state. Removing
    // this guard after every layer is configured gives the whole stack one
    // shared CSS animation start time without replacing the character root.
    if (restartAnimation) {
      root.classList.add('is-resetting-animation');
    }

    root.dataset.state = props.state;
    root.dataset.direction = props.direction;

    LAYER_DEFINITIONS.forEach((definition) => {
      if (!definition.slot) return;
      const element = layerElements.get(definition.key);
      if (!element) return;
      const selected = assetsForEquipmentLayer(
        definition,
        props.itemIds,
        resolvedGeneratedItems,
      );
      const selectedItem = catalogItemFor(
        definition.slot,
        props.itemIds[definition.slot],
        resolvedGeneratedItems[definition.slot],
      );
      element.dataset.itemId = selectedItem.id;
      setImageVariable(element, '--lpc-idle-image', selected.idle);
      setImageVariable(element, '--lpc-walk-image', selected.walk);
      if (selected.idleBreath) {
        setImageVariable(
          element,
          '--lpc-idle-breath-image',
          selected.idleBreath,
        );
        element.classList.add('has-idle-breath-layer');
      } else {
        element.style.removeProperty('--lpc-idle-breath-image');
        element.classList.remove('has-idle-breath-layer');
      }
      if (selected.hurt) {
        setImageVariable(element, '--lpc-hurt-image', selected.hurt);
        element.classList.add('has-hurt-layer');
      } else {
        element.style.removeProperty('--lpc-hurt-image');
        element.classList.remove('has-hurt-layer');
      }
    });

    const hasVisibleEquipment = (Object.keys(props.loadout) as VisualSlot[]).some(
      (slot) =>
        props.loadout[slot] &&
        (props.state !== 'hurt' ||
          slotSupportsHurt(
            slot,
            props.itemIds[slot],
            resolvedGeneratedItems[slot],
          )),
    );
    root.dataset.equipmentVisible = String(hasVisibleEquipment);
    root.style.setProperty('--lpc-scale', String(props.scale));
    root.style.setProperty(
      '--lpc-idle-breath-delay',
      `${idleBreathDelayForSlot(instance.currentInput.slot)}ms`,
    );
    root.setAttribute(
      'aria-label',
      `${props.name}, level ${props.level}, ${props.state} ${props.direction}`,
    );

    nameElement.textContent = props.name;
    levelElement.textContent = `Level ${props.level}`;
    stateElement.textContent = `State: ${props.state}`;
    directionElement.textContent = `Direction: ${props.direction}`;
    updateElement.textContent = `Updates: ${updateCount}`;

    (Object.keys(equipmentElements) as VisualSlot[]).forEach((slot) => {
      const shouldHide = !props.loadout[slot];
      equipmentElements[slot].forEach((element) => {
        if (
          element.classList.contains('is-loadout-hidden') !== shouldHide
        ) {
          element.classList.toggle('is-loadout-hidden', shouldHide);
        }
      });
    });

    layerElements.forEach((element) => {
      element.classList.remove(...ANIMATION_STATE_CLASSES);

      if (props.state === 'hurt') {
        element.classList.add(
          element.classList.contains('has-hurt-layer')
            ? 'is-hurt-animation'
            : 'is-hurt-unsupported',
        );
      } else {
        if (props.state === 'walk') {
          element.classList.add('is-walk-animation');
        } else {
          const definition = LAYER_DEFINITIONS.find(
            (candidate) => candidate.key === element.dataset.layer,
          );
          const slotVisible =
            !definition?.slot || Boolean(props.loadout[definition.slot]);
          if (element.classList.contains('has-idle-breath-layer')) {
            element.classList.add('is-idle-breath-animation');
          } else {
            element.classList.add('is-idle-frame');
            if (definition && slotVisible) warnMissingIdleBreath(definition);
          }
        }
      }
    });

    warningsElement.replaceChildren(
      ...warnings.map((warning) => {
        const item = document.createElement('li');
        item.textContent = warning;
        return item;
      }),
    );
    warningsElement.hidden = warnings.length === 0;

    if (restartAnimation) {
      void stack.offsetWidth;
      root.classList.remove('is-resetting-animation');
    }
  };

  synchronizeGeneratedRequests();
  renderMappedState(false);
  container.append(root);
  return instance;
};

export const updateLpcCharacter = (
  instance: LpcCharacterInstance,
  patch: DungeonPlayerPatch,
): void => {
  instance.update(patch);
};

export const destroyLpcCharacter = (
  instance: LpcCharacterInstance,
): void => {
  instance.destroy();
};
