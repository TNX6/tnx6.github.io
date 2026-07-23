import {
  DUNGEON_EQUIPMENT_FRAME_SIZE,
  DUNGEON_EQUIPMENT_LAYER_ORDER,
  DUNGEON_EQUIPMENT_SHEET_CONTRACT,
  EMPTY_DUNGEON_EQUIPMENT_LOADOUT,
  equipmentIsVisibleInState,
  equipmentLayerFor,
  type DungeonEquipmentAssetDefinition,
  type DungeonEquipmentAssetLayer,
  type DungeonEquipmentAssetPart,
  type DungeonEquipmentBasePalette,
  type DungeonEquipmentBaseState,
  type DungeonEquipmentBaseStyle,
  type DungeonEquipmentLayerName,
  type DungeonEquipmentLoadoutVisual,
  type DungeonEquipmentSlot,
  type DungeonEquipmentWearableState,
} from './dungeon-equipment-asset-contract.ts';
import {
  DUNGEON_EQUIPMENT_ASSET_BY_ITEM_KEY,
  DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
} from './dungeon-equipment-assets.ts';
import {
  DungeonEquipmentLayerAssetLoader,
  type DungeonLayerAssetLoadResult,
} from './dungeon-equipment-layer-preloader.ts';

const EQUIPMENT_LAYERS: readonly DungeonEquipmentAssetLayer[] = [
  'weapon-back',
  'boots',
  'armor',
  'helmet',
  'weapon-front',
];

export interface DungeonLayeredActorCounters {
  nodesCreated: number;
  stateTransitions: number;
  loadoutUpdates: number;
  layerAssetUpdates: number;
}

export interface DungeonEquipmentRenderableBaseStyle extends Omit<DungeonEquipmentBaseStyle, 'paths'> {
  readonly paths: Readonly<Partial<Record<DungeonEquipmentBaseState, string>>>;
}

export interface DungeonEquipmentRenderableAssetDefinition
  extends Omit<DungeonEquipmentAssetDefinition, 'states' | 'paths'> {
  readonly states: readonly DungeonEquipmentWearableState[];
  readonly paths: Readonly<
    Partial<Record<DungeonEquipmentWearableState, Readonly<Partial<Record<DungeonEquipmentAssetPart, string>>>>>
  >;
}

export interface DungeonLayeredActor {
  readonly actor: HTMLElement;
  readonly figure: HTMLElement;
  readonly nodes: ReadonlyMap<DungeonEquipmentLayerName, HTMLElement>;
  readonly counters: DungeonLayeredActorCounters;
  readonly manifest: ReadonlyMap<string, DungeonEquipmentRenderableAssetDefinition>;
  readonly baseManifest: Readonly<Partial<Record<DungeonEquipmentBasePalette, DungeonEquipmentRenderableBaseStyle>>>;
  readonly failedAssetUrls: Set<string>;
  palette: DungeonEquipmentBasePalette;
  state: DungeonEquipmentBaseState;
  loadout: DungeonEquipmentLoadoutVisual;
  destroyed: boolean;
}

export interface CreateLayeredActorOptions {
  readonly host: HTMLElement;
  readonly palette?: DungeonEquipmentBasePalette;
  readonly state?: DungeonEquipmentBaseState;
  readonly loadout?: Partial<DungeonEquipmentLoadoutVisual>;
  readonly displayName?: string;
  readonly documentRef?: Pick<Document, 'createElement'>;
  readonly manifest?: ReadonlyMap<string, DungeonEquipmentRenderableAssetDefinition>;
  readonly baseManifest?: Readonly<Partial<Record<DungeonEquipmentBasePalette, DungeonEquipmentRenderableBaseStyle>>>;
  readonly includeDecorations?: boolean;
}

function element(documentRef: Pick<Document, 'createElement'>, className: string): HTMLElement {
  const node = documentRef.createElement('span');
  node.classList.add(className);
  return node;
}

function layerClass(layer: DungeonEquipmentLayerName): string {
  return `deq-layer--${layer}`;
}

function applyLayerAsset(
  actor: DungeonLayeredActor,
  layer: DungeonEquipmentAssetLayer,
  url: string | null,
  state: DungeonEquipmentBaseState
): void {
  const node = actor.nodes.get(layer);
  if (!node) return;
  const existing = node.dataset.assetUrl ?? '';
  if (!url) {
    if (existing) actor.counters.layerAssetUpdates += 1;
    delete node.dataset.assetUrl;
    node.style.removeProperty('--deq-layer-image');
    node.hidden = true;
    node.dataset.loadStatus = 'idle';
    return;
  }
  if (existing !== url) actor.counters.layerAssetUpdates += 1;
  node.dataset.assetUrl = url;
  node.dataset.assetState = state;
  node.style.setProperty('--deq-layer-image', `url("${url}")`);
  const failed = actor.failedAssetUrls.has(url);
  node.hidden = failed && layer !== 'base-body';
  node.dataset.loadStatus = failed ? 'failed' : 'idle';
}

function itemFor(actor: DungeonLayeredActor, itemKey: string | null): DungeonEquipmentRenderableAssetDefinition | null {
  return itemKey ? (actor.manifest.get(itemKey) ?? null) : null;
}

function itemLayerUrl(
  item: DungeonEquipmentRenderableAssetDefinition | null,
  state: DungeonEquipmentBaseState,
  part: DungeonEquipmentAssetPart
): string | null {
  if (!item || !equipmentIsVisibleInState(state)) return null;
  return item.paths[state]?.[part] ?? null;
}

function syncBase(actor: DungeonLayeredActor): void {
  const base = actor.baseManifest[actor.palette] ?? actor.baseManifest.red ?? Object.values(actor.baseManifest)[0];
  applyLayerAsset(actor, 'base-body', base?.paths[actor.state] ?? null, actor.state);
}

function syncSlot(actor: DungeonLayeredActor, slot: DungeonEquipmentSlot): void {
  const item = itemFor(actor, actor.loadout[slot]);
  if (slot === 'weapon') {
    applyLayerAsset(actor, 'weapon-back', itemLayerUrl(item, actor.state, 'back'), actor.state);
    applyLayerAsset(actor, 'weapon-front', itemLayerUrl(item, actor.state, 'front'), actor.state);
    if (item?.linkedWeaponParts) {
      const weaponNodes = [actor.nodes.get('weapon-back'), actor.nodes.get('weapon-front')].filter(
        (node): node is HTMLElement => Boolean(node?.dataset.assetUrl)
      );
      if (weaponNodes.some((node) => node.dataset.loadStatus === 'failed')) {
        weaponNodes.forEach((node) => {
          node.hidden = true;
          node.dataset.loadStatus = 'failed-linked';
        });
      }
    }
    return;
  }
  applyLayerAsset(actor, equipmentLayerFor(slot, 'main'), itemLayerUrl(item, actor.state, 'main'), actor.state);
}

function syncAnimationContract(actor: DungeonLayeredActor): void {
  const contract = DUNGEON_EQUIPMENT_SHEET_CONTRACT[actor.state];
  const speed = Number(actor.actor.dataset.animationSpeed || 1);
  const loopEnabled = actor.actor.dataset.animationLoop !== 'false';
  actor.actor.dataset.layeredState = actor.state;
  actor.actor.style.setProperty('--deq-frame-count', String(contract.frames));
  actor.actor.style.setProperty('--deq-frame-duration', `${contract.durationMs}ms`);
  actor.actor.style.setProperty('--deq-playback-duration', `${contract.durationMs / speed}ms`);
  actor.actor.style.setProperty('--deq-animation-iteration', contract.loop && loopEnabled ? 'infinite' : '1');
  actor.nodes.forEach((node, layer) => {
    if (layer === 'shadow' || layer === 'effects-accent' || layer === 'meta') return;
    node.dataset.frameCount = String(contract.frames);
  });
}

function syncStateDecorations(actor: DungeonLayeredActor): void {
  const shadow = actor.nodes.get('shadow');
  if (shadow) shadow.hidden = actor.state === 'ghost';
}

export function createLayeredActor(options: CreateLayeredActorOptions): DungeonLayeredActor {
  const documentRef = options.documentRef ?? document;
  const actor = element(documentRef, 'deq-layered-actor');
  const figure = element(documentRef, 'deq-layered-figure');
  const nodes = new Map<DungeonEquipmentLayerName, HTMLElement>();
  const counters: DungeonLayeredActorCounters = {
    nodesCreated: 2,
    stateTransitions: 0,
    loadoutUpdates: 0,
    layerAssetUpdates: 0,
  };

  const includedLayers: readonly DungeonEquipmentLayerName[] =
    options.includeDecorations === false
      ? DUNGEON_EQUIPMENT_LAYER_ORDER.filter(
          (layer) => layer !== 'shadow' && layer !== 'effects-accent' && layer !== 'meta'
        )
      : DUNGEON_EQUIPMENT_LAYER_ORDER;

  includedLayers.forEach((layer) => {
    const node = element(documentRef, layer === 'meta' ? 'deq-layered-meta' : 'deq-layer');
    node.classList.add(layerClass(layer));
    node.dataset.layer = layer;
    node.ariaHidden = 'true';
    node.tabIndex = -1;
    if (layer === 'meta') node.textContent = options.displayName ?? 'DEV PLAYER';
    nodes.set(layer, node);
    figure.append(node);
    counters.nodesCreated += 1;
  });
  actor.append(figure);
  actor.dataset.palette = options.palette ?? 'red';
  actor.ariaHidden = 'true';
  actor.tabIndex = -1;
  options.host.append(actor);

  const layeredActor: DungeonLayeredActor = {
    actor,
    figure,
    nodes,
    counters,
    manifest: options.manifest ?? DUNGEON_EQUIPMENT_ASSET_BY_ITEM_KEY,
    baseManifest: options.baseManifest ?? DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
    failedAssetUrls: new Set<string>(),
    palette: options.palette ?? 'red',
    state: options.state ?? 'idle',
    loadout: { ...EMPTY_DUNGEON_EQUIPMENT_LOADOUT, ...options.loadout },
    destroyed: false,
  };

  syncAnimationContract(layeredActor);
  syncBase(layeredActor);
  (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => syncSlot(layeredActor, slot));
  syncStateDecorations(layeredActor);
  return layeredActor;
}

export function setLayeredActorState(actor: DungeonLayeredActor, state: DungeonEquipmentBaseState): boolean {
  if (actor.destroyed || actor.state === state) return false;
  actor.state = state;
  actor.counters.stateTransitions += 1;
  syncAnimationContract(actor);
  syncBase(actor);
  (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => syncSlot(actor, slot));
  syncStateDecorations(actor);
  return true;
}

export function setLayeredActorPalette(actor: DungeonLayeredActor, palette: DungeonEquipmentBasePalette): boolean {
  if (actor.destroyed || actor.palette === palette) return false;
  actor.palette = palette;
  actor.actor.dataset.palette = palette;
  syncBase(actor);
  return true;
}

export function setLayeredActorLoadout(
  actor: DungeonLayeredActor,
  next: Partial<DungeonEquipmentLoadoutVisual>
): readonly DungeonEquipmentSlot[] {
  if (actor.destroyed) return [];
  const changed: DungeonEquipmentSlot[] = [];
  const loadout = { ...actor.loadout };
  (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => {
    if (!(slot in next) || next[slot] === actor.loadout[slot]) return;
    loadout[slot] = next[slot] ?? null;
    changed.push(slot);
  });
  if (changed.length === 0) return changed;
  actor.loadout = loadout;
  actor.counters.loadoutUpdates += 1;
  changed.forEach((slot) => syncSlot(actor, slot));
  return changed;
}

export function setLayeredActorAnimationPaused(actor: DungeonLayeredActor, paused: boolean): void {
  actor.actor.dataset.animationPaused = paused ? 'true' : 'false';
}

export function setLayeredActorAnimationLoop(actor: DungeonLayeredActor, loop: boolean): void {
  actor.actor.dataset.animationLoop = loop ? 'true' : 'false';
  syncAnimationContract(actor);
}

export function setLayeredActorManualFrame(actor: DungeonLayeredActor, frameIndex: number | null): number | null {
  if (frameIndex === null) {
    delete actor.actor.dataset.manualFrame;
    actor.actor.style.removeProperty('--deq-manual-frame-position');
    return null;
  }
  const frameCount = DUNGEON_EQUIPMENT_SHEET_CONTRACT[actor.state].frames;
  const normalized = ((Math.trunc(frameIndex) % frameCount) + frameCount) % frameCount;
  actor.actor.dataset.manualFrame = String(normalized);
  actor.actor.style.setProperty('--deq-manual-frame-position', `${-normalized * DUNGEON_EQUIPMENT_FRAME_SIZE}px`);
  return normalized;
}

export function setLayeredActorAnimationSpeed(actor: DungeonLayeredActor, speed: 0.5 | 1 | 2): void {
  actor.actor.dataset.animationSpeed = String(speed);
  actor.actor.style.setProperty('--deq-animation-speed', String(speed));
  syncAnimationContract(actor);
}

function assetNodesWithUrls(actor: DungeonLayeredActor): HTMLElement[] {
  return [...actor.nodes.values()].filter((node) => Boolean(node.dataset.assetUrl));
}

function activeAssetNodes(actor: DungeonLayeredActor): HTMLElement[] {
  return assetNodesWithUrls(actor).filter((node) => !node.hidden);
}

export async function preloadLayeredActorAssets(
  actor: DungeonLayeredActor,
  loader: DungeonEquipmentLayerAssetLoader,
  states: readonly DungeonEquipmentBaseState[] = [actor.state]
): Promise<DungeonLayerAssetLoadResult[]> {
  if (actor.destroyed) return [];
  const originalState = actor.state;
  const urls = new Set<string>();

  states.forEach((state) => {
    actor.state = state;
    syncBase(actor);
    (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => syncSlot(actor, slot));
    assetNodesWithUrls(actor).forEach((node) => {
      if (node.dataset.assetUrl) urls.add(node.dataset.assetUrl);
    });
  });
  actor.state = originalState;
  syncAnimationContract(actor);
  syncBase(actor);
  (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => syncSlot(actor, slot));
  syncStateDecorations(actor);

  const results = await loader.loadMany([...urls]);
  const byUrl = new Map(results.map((result) => [result.url, result]));
  results.forEach((result) => {
    if (result.loaded) actor.failedAssetUrls.delete(result.url);
    else actor.failedAssetUrls.add(result.url);
  });
  syncBase(actor);
  (['weapon', 'helmet', 'armor', 'boots'] as const).forEach((slot) => syncSlot(actor, slot));
  assetNodesWithUrls(actor).forEach((node) => {
    const url = node.dataset.assetUrl;
    const result = url ? byUrl.get(url) : null;
    if (!result) return;
    if (node.dataset.loadStatus === 'failed-linked') return;
    node.dataset.loadStatus = result.loaded ? 'ready' : 'failed';
    if (!result.loaded && node.dataset.layer !== 'base-body') node.hidden = true;
  });
  return results;
}

export function preloadLayeredActorJoiningAssets(
  actor: DungeonLayeredActor,
  loader: DungeonEquipmentLayerAssetLoader
): Promise<DungeonLayerAssetLoadResult[]> {
  return preloadLayeredActorAssets(actor, loader, ['idle', 'walk-back']);
}

export function destroyLayeredActor(actor: DungeonLayeredActor): void {
  if (actor.destroyed) return;
  actor.destroyed = true;
  actor.actor.remove();
}

export function layeredActorNodeOrder(actor: DungeonLayeredActor): DungeonEquipmentLayerName[] {
  return [...actor.figure.children].map((node) => (node as HTMLElement).dataset.layer as DungeonEquipmentLayerName);
}

export function activeLayerUrls(actor: DungeonLayeredActor): string[] {
  return activeAssetNodes(actor)
    .map((node) => node.dataset.assetUrl)
    .filter((url): url is string => Boolean(url));
}

export function assetLayerNodes(actor: DungeonLayeredActor): readonly HTMLElement[] {
  return EQUIPMENT_LAYERS.map((layer) => actor.nodes.get(layer)).filter((node): node is HTMLElement => Boolean(node));
}
