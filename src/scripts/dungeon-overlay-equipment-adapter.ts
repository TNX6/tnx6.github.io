import {
  DUNGEON_EQUIPMENT_ANIMATION_STATE_MAP,
  type DungeonEquipmentBasePalette,
  type DungeonEquipmentBaseState,
  type DungeonEquipmentLoadoutVisual,
  type DungeonEquipmentSlot,
} from './dungeon-equipment-asset-contract.ts';
import {
  DUNGEON_EQUIPMENT_ASSET_BY_SPRITE_KEY,
  DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
} from './dungeon-equipment-assets.ts';
import {
  createLayeredActor,
  destroyLayeredActor,
  preloadLayeredActorAssets,
  setLayeredActorLoadout,
  setLayeredActorState,
  type DungeonLayeredActor,
} from './dungeon-equipment-layer-renderer.ts';
import {
  DungeonEquipmentLayerAssetLoader,
  type DungeonLayerAssetLoadResult,
} from './dungeon-equipment-layer-preloader.ts';
import type { DungeonPlayerAnimationState } from './dungeon-overlay-animation-state.ts';

const LOADOUT_SLOTS = ['weapon', 'helmet', 'armor', 'boots'] as const;
const SAFE_SPRITE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INITIAL_PRELOAD_STATES = ['idle', 'walk-back', 'death', 'ghost'] as const;

export const DUNGEON_OVERLAY_PALETTE_BY_SLOT = Object.freeze({
  1: 'red',
  2: 'purple',
  3: 'green',
  4: 'orange',
  5: 'blue',
  6: 'black-gold',
} as const satisfies Record<number, DungeonEquipmentBasePalette>);

export interface DungeonViewerVisualLoadoutEntry {
  readonly spriteKey: string;
}

export interface DungeonViewerVisualLoadout {
  readonly weapon: DungeonViewerVisualLoadoutEntry | null;
  readonly helmet: DungeonViewerVisualLoadoutEntry | null;
  readonly armor: DungeonViewerVisualLoadoutEntry | null;
  readonly boots: DungeonViewerVisualLoadoutEntry | null;
}

export type NormalizedDungeonViewerVisualLoadout =
  | { readonly mode: 'legacy' }
  | {
      readonly mode: 'layered';
      readonly loadout: DungeonEquipmentLoadoutVisual;
      readonly signature: string;
    };

export interface DungeonOverlayEquipmentAdapterCounters {
  playerNodeCreations: number;
  layeredActorCreations: number;
  baseLayerCreations: number;
  equipmentLayerCreations: number;
  stateChanges: number;
  loadoutChanges: number;
}

export interface DungeonOverlayEquipmentDiagnostics extends DungeonOverlayEquipmentAdapterCounters {
  preloadRequests: number;
  decodeCalls: number;
  cacheHits: number;
  actorCount: number;
}

export interface DungeonOverlayEquipmentWarning {
  readonly code:
    | 'invalid_slot'
    | 'renderer_mode_changed'
    | 'base_asset_failed'
    | 'equipment_asset_failed'
    | 'steel_linked_asset_failed';
  readonly runId: string;
  readonly slotNumber: number;
  readonly spriteKey?: string;
  readonly url?: string;
}

export interface DungeonOverlayEquipmentAdapterOptions {
  readonly loader?: DungeonEquipmentLayerAssetLoader;
  readonly warn?: (warning: DungeonOverlayEquipmentWarning) => void;
  readonly initialPlayerNodeCount?: number;
  readonly documentRef?: Pick<Document, 'createElement'>;
}

export interface ReconcileDungeonOverlayEquipmentInput {
  readonly runId: string;
  readonly slotNumber: number;
  readonly playerActor: HTMLElement;
  readonly figure: HTMLElement;
  readonly legacyAvatar: HTMLElement;
  readonly visualLoadoutPresent: boolean;
  readonly visualLoadout: DungeonViewerVisualLoadout | null | undefined;
}

export type DungeonOverlayEquipmentRenderMode = 'legacy' | 'layered';

interface LayeredActorRecord {
  readonly runId: string;
  readonly slotNumber: number;
  readonly playerActor: HTMLElement;
  readonly figure: HTMLElement;
  readonly legacyAvatar: HTMLElement;
  readonly requestedMode: DungeonOverlayEquipmentRenderMode;
  readonly palette: DungeonEquipmentBasePalette | null;
  readonly layeredActor: DungeonLayeredActor | null;
  readonly requestedStates: Set<DungeonEquipmentBaseState>;
  readonly readyStates: Set<DungeonEquipmentBaseState>;
  desiredState: DungeonPlayerAnimationState;
  loadoutSignature: string;
  preloadGeneration: number;
  baseFailed: boolean;
  ready: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeVisualEntry(value: unknown): DungeonViewerVisualLoadoutEntry | null {
  if (!isRecord(value) || typeof value.spriteKey !== 'string') return null;
  const spriteKey = value.spriteKey.trim();
  if (!SAFE_SPRITE_KEY.test(spriteKey) || spriteKey.length > 64) return null;
  return { spriteKey };
}

export function parseViewerVisualLoadout(value: unknown): DungeonViewerVisualLoadout | null {
  if (!isRecord(value)) return null;
  return {
    weapon: safeVisualEntry(value.weapon),
    helmet: safeVisualEntry(value.helmet),
    armor: safeVisualEntry(value.armor),
    boots: safeVisualEntry(value.boots),
  };
}

export function normalizeViewerVisualLoadout(
  visualLoadout: unknown,
  fieldPresent: boolean,
  slotNumber: number
): NormalizedDungeonViewerVisualLoadout {
  if (
    !fieldPresent ||
    visualLoadout === null ||
    !isRecord(visualLoadout) ||
    !(slotNumber in DUNGEON_OVERLAY_PALETTE_BY_SLOT)
  ) {
    return { mode: 'legacy' };
  }

  const loadout = {} as Record<DungeonEquipmentSlot, string | null>;
  const signature: string[] = [];
  LOADOUT_SLOTS.forEach((slot) => {
    const entry = safeVisualEntry(visualLoadout[slot]);
    const definition = entry ? DUNGEON_EQUIPMENT_ASSET_BY_SPRITE_KEY.get(entry.spriteKey) : null;
    const accepted = definition?.slot === slot ? definition : null;
    loadout[slot] = accepted?.itemKey ?? null;
    signature.push(accepted?.spriteKey ?? '');
  });

  return {
    mode: 'layered',
    loadout,
    signature: signature.join('|'),
  };
}

export function dungeonEquipmentStateForOverlay(state: DungeonPlayerAnimationState): DungeonEquipmentBaseState | null {
  if (state === 'inside' || state === 'hit') return null;
  return DUNGEON_EQUIPMENT_ANIMATION_STATE_MAP[state];
}

function baseUrlsFor(
  palette: DungeonEquipmentBasePalette,
  states: readonly DungeonEquipmentBaseState[]
): ReadonlySet<string> {
  const base = DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST[palette];
  return new Set(states.map((state) => base.paths[state]));
}

function failedEquipmentWarnings(
  record: LayeredActorRecord,
  results: readonly DungeonLayerAssetLoadResult[]
): DungeonOverlayEquipmentWarning[] {
  const baseUrls = record.palette ? baseUrlsFor(record.palette, [...record.requestedStates]) : new Set<string>();
  const failures = results.filter((result) => !result.loaded && !baseUrls.has(result.url));
  const warnings: DungeonOverlayEquipmentWarning[] = [];
  failures.forEach((result) => {
    const steelFailure = result.url.includes('/items/steel-sword/');
    warnings.push({
      code: steelFailure ? 'steel_linked_asset_failed' : 'equipment_asset_failed',
      runId: record.runId,
      slotNumber: record.slotNumber,
      url: result.url,
    });
  });
  return warnings;
}

export class DungeonOverlayEquipmentAdapter {
  readonly loader: DungeonEquipmentLayerAssetLoader;
  readonly counters: DungeonOverlayEquipmentAdapterCounters;

  private readonly records = new Map<HTMLElement, LayeredActorRecord>();
  private readonly warn: (warning: DungeonOverlayEquipmentWarning) => void;
  private readonly documentRef?: Pick<Document, 'createElement'>;

  constructor(options: DungeonOverlayEquipmentAdapterOptions = {}) {
    this.loader = options.loader ?? new DungeonEquipmentLayerAssetLoader({ concurrency: 5 });
    this.warn =
      options.warn ??
      ((warning) => {
        console.warn('[TNX6 Dungeon Equipment]', warning);
      });
    this.documentRef = options.documentRef;
    this.counters = {
      playerNodeCreations: options.initialPlayerNodeCount ?? 0,
      layeredActorCreations: 0,
      baseLayerCreations: 0,
      equipmentLayerCreations: 0,
      stateChanges: 0,
      loadoutChanges: 0,
    };
  }

  async reconcile(input: ReconcileDungeonOverlayEquipmentInput): Promise<DungeonOverlayEquipmentRenderMode> {
    const normalized = normalizeViewerVisualLoadout(input.visualLoadout, input.visualLoadoutPresent, input.slotNumber);
    if (!(input.slotNumber in DUNGEON_OVERLAY_PALETTE_BY_SLOT)) {
      this.warn({ code: 'invalid_slot', runId: input.runId, slotNumber: input.slotNumber });
    }

    let record = this.records.get(input.playerActor);
    if (record && (record.runId !== input.runId || record.slotNumber !== input.slotNumber)) {
      this.remove(input.playerActor);
      record = undefined;
    }

    if (record && record.requestedMode !== normalized.mode) {
      this.warn({
        code: 'renderer_mode_changed',
        runId: input.runId,
        slotNumber: input.slotNumber,
      });
      return record.baseFailed ? 'legacy' : record.requestedMode;
    }

    if (!record) {
      record = this.createRecord(input, normalized);
      this.records.set(input.playerActor, record);
    }

    if (normalized.mode === 'legacy' || !record.layeredActor) {
      this.useLegacy(record);
      return 'legacy';
    }

    if (record.loadoutSignature !== normalized.signature) {
      this.useLegacy(record);
      record.loadoutSignature = normalized.signature;
      const changed = setLayeredActorLoadout(record.layeredActor, normalized.loadout);
      if (changed.length > 0) {
        this.counters.loadoutChanges += 1;
        record.readyStates.clear();
        record.requestedStates.clear();
        record.preloadGeneration += 1;
      }
    }

    await this.preload(record, this.initialStatesFor(record.desiredState));
    if (record.baseFailed) return 'legacy';
    this.applyDesiredState(record);
    return 'layered';
  }

  setState(playerActor: HTMLElement, state: DungeonPlayerAnimationState): void {
    const record = this.records.get(playerActor);
    if (!record) return;
    record.desiredState = state;
    if (record.requestedMode !== 'layered' || !record.layeredActor || record.baseFailed) {
      this.useLegacy(record);
      return;
    }

    const mapped = dungeonEquipmentStateForOverlay(state);
    if (mapped && !record.readyStates.has(mapped)) {
      this.useLegacy(record);
      void this.preload(record, [mapped]).then(() => this.applyDesiredState(record));
      return;
    }
    this.applyDesiredState(record);
    if (state === 'inside' || state === 'hit') {
      void this.preload(record, ['walk-front']);
    }
  }

  remove(playerActor: HTMLElement): void {
    const record = this.records.get(playerActor);
    if (!record) return;
    record.preloadGeneration += 1;
    if (record.layeredActor) destroyLayeredActor(record.layeredActor);
    record.legacyAvatar.hidden = false;
    delete record.playerActor.dataset.renderMode;
    delete record.playerActor.dataset.layeredReady;
    this.records.delete(playerActor);
  }

  clear(): void {
    [...this.records.keys()].forEach((actor) => this.remove(actor));
  }

  diagnostics(): DungeonOverlayEquipmentDiagnostics {
    return {
      ...this.counters,
      preloadRequests: this.loader.counters.requests,
      decodeCalls: this.loader.counters.decodeCalls,
      cacheHits: this.loader.counters.cacheHits,
      actorCount: this.records.size,
    };
  }

  recordFor(playerActor: HTMLElement): Readonly<LayeredActorRecord> | null {
    return this.records.get(playerActor) ?? null;
  }

  private createRecord(
    input: ReconcileDungeonOverlayEquipmentInput,
    normalized: NormalizedDungeonViewerVisualLoadout
  ): LayeredActorRecord {
    const palette = DUNGEON_OVERLAY_PALETTE_BY_SLOT[
      input.slotNumber as keyof typeof DUNGEON_OVERLAY_PALETTE_BY_SLOT
    ] as DungeonEquipmentBasePalette | undefined;
    const desiredState =
      (input.playerActor.dataset.animationState as DungeonPlayerAnimationState | undefined) ?? 'inside';
    const layeredActor =
      normalized.mode === 'layered' && palette
        ? createLayeredActor({
            host: input.figure,
            palette,
            state: dungeonEquipmentStateForOverlay(desiredState) ?? 'idle',
            loadout: normalized.loadout,
            includeDecorations: false,
            documentRef: this.documentRef,
          })
        : null;

    if (layeredActor) {
      layeredActor.actor.classList.add('dov-layered-actor');
      layeredActor.actor.hidden = true;
      this.counters.layeredActorCreations += 1;
      this.counters.baseLayerCreations += 1;
      this.counters.equipmentLayerCreations += 5;
    }

    const record: LayeredActorRecord = {
      runId: input.runId,
      slotNumber: input.slotNumber,
      playerActor: input.playerActor,
      figure: input.figure,
      legacyAvatar: input.legacyAvatar,
      requestedMode: normalized.mode,
      palette: palette ?? null,
      layeredActor,
      requestedStates: new Set<DungeonEquipmentBaseState>(),
      readyStates: new Set<DungeonEquipmentBaseState>(),
      desiredState,
      loadoutSignature: normalized.mode === 'layered' ? normalized.signature : '',
      preloadGeneration: 0,
      baseFailed: false,
      ready: false,
    };
    this.useLegacy(record);
    return record;
  }

  private initialStatesFor(state: DungeonPlayerAnimationState): DungeonEquipmentBaseState[] {
    const states: DungeonEquipmentBaseState[] = [...INITIAL_PRELOAD_STATES];
    if (state === 'inside' || state === 'hit' || state === 'returning') states.push('walk-front');
    return states;
  }

  private async preload(record: LayeredActorRecord, states: readonly DungeonEquipmentBaseState[]): Promise<void> {
    if (!record.layeredActor || !record.palette || record.baseFailed) return;
    const missing = [...new Set(states)].filter(
      (state) => !record.requestedStates.has(state) && !record.readyStates.has(state)
    );
    if (missing.length === 0) return;
    missing.forEach((state) => record.requestedStates.add(state));
    const generation = record.preloadGeneration;
    const results = await preloadLayeredActorAssets(record.layeredActor, this.loader, missing);
    if (generation !== record.preloadGeneration || this.records.get(record.playerActor) !== record) return;

    const baseUrls = baseUrlsFor(record.palette, missing);
    const failedBase = results.find((result) => !result.loaded && baseUrls.has(result.url));
    if (failedBase) {
      record.baseFailed = true;
      this.useLegacy(record);
      this.warn({
        code: 'base_asset_failed',
        runId: record.runId,
        slotNumber: record.slotNumber,
        url: failedBase.url,
      });
      return;
    }

    missing.forEach((state) => record.readyStates.add(state));
    failedEquipmentWarnings(record, results).forEach(this.warn);
    record.ready = true;
  }

  private applyDesiredState(record: LayeredActorRecord): void {
    const layered = record.layeredActor;
    if (!layered || record.baseFailed || !record.ready) {
      this.useLegacy(record);
      return;
    }
    const mapped = dungeonEquipmentStateForOverlay(record.desiredState);
    if (!mapped) {
      record.legacyAvatar.hidden = true;
      layered.actor.hidden = true;
      record.playerActor.dataset.renderMode = 'layered';
      record.playerActor.dataset.layeredReady = 'true';
      return;
    }
    if (!record.readyStates.has(mapped)) {
      this.useLegacy(record);
      return;
    }
    if (setLayeredActorState(layered, mapped)) this.counters.stateChanges += 1;
    record.legacyAvatar.hidden = true;
    layered.actor.hidden = false;
    record.playerActor.dataset.renderMode = 'layered';
    record.playerActor.dataset.layeredReady = 'true';
  }

  private useLegacy(record: LayeredActorRecord): void {
    record.legacyAvatar.hidden = false;
    if (record.layeredActor) record.layeredActor.actor.hidden = true;
    record.playerActor.dataset.renderMode = 'legacy';
    record.playerActor.dataset.layeredReady = 'false';
  }
}
