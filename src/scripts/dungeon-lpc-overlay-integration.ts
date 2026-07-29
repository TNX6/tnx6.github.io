import '../styles/dungeon-lpc-overlay-integration.css';
import {
  createLpcCharacter,
  destroyLpcCharacter,
  updateLpcCharacter,
  type LpcCharacterInstance,
} from './dungeon-lpc-renderer';
import type { DungeonPlayerInput, DungeonVisualLoadout } from './dungeon-lpc-adapter';
import type { DungeonViewerVisualLoadout } from './dungeon-overlay-equipment-adapter';
import type { DungeonPlayerAnimationState } from './dungeon-overlay-animation-state';

type ProductionVisualLoadout = DungeonViewerVisualLoadout & {
  readonly legs?: { readonly spriteKey: string } | null;
  readonly shield?: { readonly spriteKey: string } | null;
};

export interface DungeonLpcOverlayPlayer {
  readonly name: string;
  readonly level?: number | null;
  readonly outcome?: 'survived' | 'dead';
  readonly presentationKey?: string;
  readonly status?: string;
  readonly direction?: string;
  readonly animationState?: string;
  readonly visualLoadout?: ProductionVisualLoadout | null;
}

interface SlotRecord {
  readonly host: HTMLElement;
  readonly instance: LpcCharacterInstance;
  playerKey: string;
  signature: string;
}

interface LpcOverlaySlotConfiguration {
  readonly scale: 2 | 3;
  readonly slotLeft: number;
  readonly slotTop: number;
  readonly finalOffsetX: number;
  readonly finalOffsetY: number;
  readonly entryOffsetX: number;
  readonly entryOffsetY: number;
  readonly exitOffsetX: number;
  readonly exitOffsetY: number;
  readonly zIndex: number;
  readonly identityBottom: number;
  readonly breathDelay: number;
}

interface DebugSlotElements {
  readonly currentBounds: SVGRectElement;
  readonly currentLabel: SVGTextElement;
}

const LPC_FRAME_SIZE = 64;
const LPC_HOST_LEFT = 9;
const LPC_HOST_TOP = -10;
const LPC_COLLISION_WIDTH = 100;
const LPC_COLLISION_HEIGHT = 170;

export const LPC_OVERLAY_SLOT_CONFIGURATION = Object.freeze([
  Object.freeze({
    scale: 3,
    slotLeft: 465,
    slotTop: 418,
    finalOffsetX: 0,
    finalOffsetY: -4,
    entryOffsetX: 4,
    entryOffsetY: -22,
    exitOffsetX: 4,
    exitOffsetY: -22,
    zIndex: 5,
    identityBottom: 138,
    breathDelay: 0,
  }),
  Object.freeze({
    scale: 3,
    slotLeft: 570,
    slotTop: 373,
    finalOffsetX: 0,
    finalOffsetY: -2,
    entryOffsetX: 14,
    entryOffsetY: -14,
    exitOffsetX: 14,
    exitOffsetY: -18,
    zIndex: 3,
    identityBottom: 135,
    breathDelay: -350,
  }),
  Object.freeze({
    scale: 3,
    slotLeft: 225,
    slotTop: 418,
    finalOffsetX: 0,
    finalOffsetY: -4,
    entryOffsetX: -14,
    entryOffsetY: -22,
    exitOffsetX: -16,
    exitOffsetY: -22,
    zIndex: 5,
    identityBottom: 138,
    breathDelay: -700,
  }),
  Object.freeze({
    scale: 3,
    slotLeft: 350,
    slotTop: 373,
    finalOffsetX: 0,
    finalOffsetY: -2,
    entryOffsetX: 14,
    entryOffsetY: -14,
    exitOffsetX: 16,
    exitOffsetY: -18,
    zIndex: 3,
    identityBottom: 135,
    breathDelay: -1050,
  }),
  Object.freeze({
    scale: 3,
    slotLeft: 0,
    slotTop: 418,
    finalOffsetX: 0,
    finalOffsetY: -4,
    entryOffsetX: -14,
    entryOffsetY: -22,
    exitOffsetX: -14,
    exitOffsetY: -22,
    zIndex: 5,
    identityBottom: 138,
    breathDelay: -1400,
  }),
  Object.freeze({
    scale: 3,
    slotLeft: 110,
    slotTop: 373,
    finalOffsetX: 0,
    finalOffsetY: -2,
    entryOffsetX: -8,
    entryOffsetY: -14,
    exitOffsetX: -8,
    exitOffsetY: -18,
    zIndex: 3,
    identityBottom: 135,
    breathDelay: -1750,
  }),
] satisfies readonly LpcOverlaySlotConfiguration[]);

const PRODUCTION_ITEM_TO_LPC = Object.freeze({
  weapon: Object.freeze({
    'rusty-sword': 'arming-sword',
    'steel-sword': 'iron-sword',
    'test-weapon': 'test-weapon',
    'arming-sword': 'arming-sword',
    'iron-sword': 'iron-sword',
  }),
  helmet: Object.freeze({
    'leather-cap': 'test-helmet',
    'iron-helmet': 'iron-helmet',
    'test-helmet': 'test-helmet',
    greathelm: 'greathelm',
  }),
  chest: Object.freeze({
    'patched-leather': 'test-armor',
    'iron-armor': 'iron-armor',
    'test-armor': 'test-armor',
    'plate-armor': 'plate-armor',
  }),
  legs: Object.freeze({
    'test-legs': 'test-legs',
    'iron-legs': 'iron-legs',
    'plate-legs': 'plate-legs',
  }),
  boots: Object.freeze({
    'traveler-boots': 'test-boots',
    'guard-boots': 'iron-boots',
    'test-boots': 'test-boots',
    'iron-boots': 'iron-boots',
    'plate-boots': 'plate-boots',
  }),
  shield: Object.freeze({
    'test-shield': 'test-shield',
    'heater-shield': 'heater-shield',
    'iron-shield': 'iron-shield',
  }),
} satisfies Record<keyof DungeonVisualLoadout, Readonly<Record<string, string>>>);

const STATE_TO_LPC = Object.freeze({
  arriving: { animationState: 'walk', direction: 'front' },
  idle: { animationState: 'idle', direction: 'front' },
  entering: { animationState: 'walk', direction: 'back' },
  inside: { animationState: 'idle', direction: 'back' },
  returning: { animationState: 'walk', direction: 'front' },
  hit: { animationState: 'hurt', direction: 'front' },
  dead: { animationState: 'hurt', direction: 'front' },
  ghost: { animationState: 'hurt', direction: 'front' },
} satisfies Record<DungeonPlayerAnimationState, { animationState: string; direction: string }>);

const normalizedItemId = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function equipmentItem(
  slot: keyof DungeonVisualLoadout,
  entry: { readonly spriteKey: string } | null | undefined,
): string | null {
  if (!entry) return null;
  const itemId = normalizedItemId(entry.spriteKey);
  return PRODUCTION_ITEM_TO_LPC[slot][itemId] ?? itemId;
}

function lpcLoadout(player: DungeonLpcOverlayPlayer): DungeonVisualLoadout | undefined {
  if (!Object.prototype.hasOwnProperty.call(player, 'visualLoadout')) return undefined;
  const loadout = player.visualLoadout;
  if (!loadout) return {};
  return {
    chest: equipmentItem('chest', loadout.armor),
    legs: equipmentItem('legs', loadout.legs),
    boots: equipmentItem('boots', loadout.boots),
    helmet: equipmentItem('helmet', loadout.helmet),
    weapon: equipmentItem('weapon', loadout.weapon),
    shield: equipmentItem('shield', loadout.shield),
  };
}

function lpcState(
  state: DungeonPlayerAnimationState,
  player: DungeonLpcOverlayPlayer,
): { animationState: string; direction: string } {
  const mapped = STATE_TO_LPC[state];
  return {
    animationState: player.animationState?.trim() || mapped.animationState,
    direction: player.direction?.trim() || mapped.direction,
  };
}

function inputFor(
  slotNumber: number,
  player: DungeonLpcOverlayPlayer,
  state: DungeonPlayerAnimationState,
): DungeonPlayerInput {
  const mappedState = lpcState(state, player);
  return {
    slot: slotNumber,
    username: player.name,
    displayName: player.name,
    level: Number.isSafeInteger(player.level) && Number(player.level) > 0 ? Number(player.level) : 1,
    status: player.status ?? player.outcome ?? state,
    animationState: mappedState.animationState,
    direction: mappedState.direction,
    visualLoadout: lpcLoadout(player),
  };
}

function inputSignature(input: DungeonPlayerInput): string {
  return JSON.stringify(input);
}

export class DungeonLpcOverlayIntegration {
  private readonly records = new Map<HTMLElement, SlotRecord>();
  private readonly failedPlayerKeys = new Map<HTMLElement, string>();
  private readonly warned = new Set<string>();
  private readonly debugLabel: HTMLElement;
  private readonly debugEnabled: boolean;
  private readonly debugSlots = new Map<HTMLElement, DebugSlotElements>();
  private debugLayer: SVGSVGElement | null = null;
  private debugFrameId: number | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly slots: readonly HTMLElement[],
  ) {
    root.dataset.dungeonRenderer = 'lpc';
    this.debugEnabled =
      new URLSearchParams(window.location.search).get('lpcDebugSlots') === '1';
    if (this.debugEnabled) root.dataset.lpcDebugSlots = 'true';

    slots.forEach((slot, index) => {
      const config = LPC_OVERLAY_SLOT_CONFIGURATION[index];
      if (!config) return;
      slot.dataset.lpcSlotConfigured = 'true';
      slot.style.left = `${config.slotLeft}px`;
      slot.style.top = `${config.slotTop}px`;
      slot.style.zIndex = String(config.zIndex);
      slot.style.setProperty('--dov-lpc-identity-bottom', `${config.identityBottom}px`);
    });

    this.debugLabel = document.createElement('span');
    this.debugLabel.className = 'dov-lpc-debug-label';
    this.debugLabel.textContent = 'LPC V1 TEST';
    this.debugLabel.setAttribute('aria-hidden', 'true');
    root.append(this.debugLabel);

    if (this.debugEnabled) this.mountDebugLayer();
  }

  reconcile(
    slot: HTMLElement,
    slotIndex: number,
    player: DungeonLpcOverlayPlayer,
    state: DungeonPlayerAnimationState,
  ): boolean {
    const playerKey = player.presentationKey ?? `slot:${slotIndex + 1}:${player.name}`;
    if (this.failedPlayerKeys.get(slot) === playerKey) return false;

    try {
      const input = inputFor(slotIndex + 1, player, state);
      const signature = inputSignature(input);
      let record = this.records.get(slot);

      if (record && record.playerKey !== playerKey) {
        this.remove(slot);
        record = undefined;
      }

      if (!record) {
        const figure = slot.querySelector<HTMLElement>('.dov-player-figure');
        const actor = slot.querySelector<HTMLElement>('.dov-player-actor');
        if (!figure || !actor) throw new Error('Character host is unavailable.');

        const host = document.createElement('span');
        host.className = 'dov-lpc-character-host';
        host.setAttribute('aria-hidden', 'true');
        this.configureHost(host, slotIndex);
        figure.append(host);

        const instance = createLpcCharacter(host, input);
        record = { host, instance, playerKey, signature };
        this.records.set(slot, record);
        actor.dataset.lpcRenderState = 'active';
      } else if (record.signature !== signature) {
        updateLpcCharacter(record.instance, input);
        record.signature = signature;
      }

      record.host.dataset.lpcIdleSettled = String(state === 'idle');
      this.reportWarnings(slotIndex + 1, playerKey, record.instance.warnings);
      return true;
    } catch (error) {
      this.failSlot(slot, slotIndex + 1, playerKey, error);
      return false;
    }
  }

  setAnimationState(slot: HTMLElement, state: DungeonPlayerAnimationState): void {
    const record = this.records.get(slot);
    if (!record) return;
    try {
      const mapped = STATE_TO_LPC[state];
      updateLpcCharacter(record.instance, mapped);
      record.host.dataset.lpcIdleSettled = String(state === 'idle');
      record.signature = inputSignature(record.instance.currentInput);
      this.reportWarnings(
        Number(slot.dataset.dovSlot) || 0,
        record.playerKey,
        record.instance.warnings,
      );
    } catch (error) {
      this.failSlot(slot, Number(slot.dataset.dovSlot) || 0, record.playerKey, error);
    }
  }

  remove(slot: HTMLElement): void {
    const record = this.records.get(slot);
    if (record) {
      destroyLpcCharacter(record.instance);
      record.host.remove();
      this.records.delete(slot);
    }
    this.failedPlayerKeys.delete(slot);
    const actor = slot.querySelector<HTMLElement>('.dov-player-actor');
    if (actor) delete actor.dataset.lpcRenderState;
    delete slot.dataset.lpcWarnings;
  }

  destroy(): void {
    this.slots.forEach((slot) => this.remove(slot));
    this.records.clear();
    this.failedPlayerKeys.clear();
    if (this.debugFrameId !== null) {
      window.cancelAnimationFrame(this.debugFrameId);
      this.debugFrameId = null;
    }
    this.debugLayer?.remove();
    this.debugLayer = null;
    this.debugSlots.clear();
    this.slots.forEach((slot) => {
      delete slot.dataset.lpcSlotConfigured;
      slot.style.removeProperty('left');
      slot.style.removeProperty('top');
      slot.style.removeProperty('z-index');
      slot.style.removeProperty('--dov-lpc-identity-bottom');
    });
    this.debugLabel.remove();
    delete this.root.dataset.dungeonRenderer;
    delete this.root.dataset.lpcDebugSlots;
  }

  diagnostics(): {
    instanceCount: number;
    duplicateRootCount: number;
    warningCount: number;
    debugSlots: boolean;
  } {
    const roots = this.root.querySelectorAll('[data-lpc-runtime-character]');
    return {
      instanceCount: this.records.size,
      duplicateRootCount: Math.max(0, roots.length - this.records.size),
      warningCount: this.warned.size,
      debugSlots: this.debugEnabled,
    };
  }

  private configureHost(host: HTMLElement, slotIndex: number): void {
    const config = LPC_OVERLAY_SLOT_CONFIGURATION[slotIndex];
    if (!config) throw new Error(`Missing LPC slot configuration for slot ${slotIndex + 1}.`);
    host.dataset.lpcSlot = String(slotIndex + 1);
    host.style.setProperty('--dov-lpc-slot-scale', String(config.scale));
    host.style.setProperty('--dov-lpc-final-x', `${config.finalOffsetX}px`);
    host.style.setProperty('--dov-lpc-final-y', `${config.finalOffsetY}px`);
    host.style.setProperty('--dov-lpc-entry-x', `${config.entryOffsetX}px`);
    host.style.setProperty('--dov-lpc-entry-y', `${config.entryOffsetY}px`);
    host.style.setProperty('--dov-lpc-exit-x', `${config.exitOffsetX}px`);
    host.style.setProperty('--dov-lpc-exit-y', `${config.exitOffsetY}px`);
    host.style.setProperty('--lpc-idle-breath-delay', `${config.breathDelay}ms`);
  }

  private mountDebugLayer(): void {
    const scene = this.root.querySelector<HTMLElement>('.dov-scene');
    if (!scene) return;
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.classList.add('dov-lpc-slot-debug-layer');
    svg.setAttribute('viewBox', '0 0 780 650');
    svg.setAttribute('aria-hidden', 'true');

    this.slots.forEach((slot, index) => {
      const config = LPC_OVERLAY_SLOT_CONFIGURATION[index];
      if (!config) return;
      const cellSize = LPC_FRAME_SIZE * config.scale;
      const rootOffsetX = (cellSize - LPC_COLLISION_WIDTH) / 2;
      const rootOffsetY = cellSize - LPC_COLLISION_HEIGHT;
      const finalX =
        config.slotLeft + LPC_HOST_LEFT + config.finalOffsetX + rootOffsetX;
      const finalY =
        config.slotTop + LPC_HOST_TOP + config.finalOffsetY + rootOffsetY;
      const entryX = finalX + config.entryOffsetX;
      const entryY = finalY + config.entryOffsetY;
      const exitX = finalX + config.exitOffsetX;
      const exitY = finalY + config.exitOffsetY;
      const safeX = Math.min(finalX, entryX, exitX);
      const safeY = Math.min(finalY, entryY, exitY);
      const safeRight =
        Math.max(finalX, entryX, exitX) + LPC_COLLISION_WIDTH;
      const safeBottom =
        Math.max(finalY, entryY, exitY) + LPC_COLLISION_HEIGHT;
      const anchorX = finalX + LPC_COLLISION_WIDTH / 2;
      const anchorY = finalY + LPC_COLLISION_HEIGHT;

      const group = document.createElementNS(namespace, 'g');
      group.dataset.lpcDebugSlot = String(index + 1);

      const safeRect = document.createElementNS(namespace, 'rect');
      safeRect.classList.add('dov-lpc-debug-safe');
      safeRect.setAttribute('x', String(safeX));
      safeRect.setAttribute('y', String(safeY));
      safeRect.setAttribute('width', String(safeRight - safeX));
      safeRect.setAttribute('height', String(safeBottom - safeY));

      const entryPath = document.createElementNS(namespace, 'line');
      entryPath.classList.add('dov-lpc-debug-entry-path');
      entryPath.setAttribute('x1', String(anchorX + config.entryOffsetX));
      entryPath.setAttribute('y1', String(anchorY + config.entryOffsetY));
      entryPath.setAttribute('x2', String(anchorX));
      entryPath.setAttribute('y2', String(anchorY));

      const finalAnchor = document.createElementNS(namespace, 'circle');
      finalAnchor.classList.add('dov-lpc-debug-final-anchor');
      finalAnchor.setAttribute('cx', String(anchorX));
      finalAnchor.setAttribute('cy', String(anchorY));
      finalAnchor.setAttribute('r', '4');

      const slotLabel = document.createElementNS(namespace, 'text');
      slotLabel.classList.add('dov-lpc-debug-slot-label');
      slotLabel.setAttribute('x', String(safeX + 5));
      slotLabel.setAttribute('y', String(safeY + 13));
      slotLabel.textContent = `SLOT ${index + 1}`;

      const currentBounds = document.createElementNS(namespace, 'rect');
      currentBounds.classList.add('dov-lpc-debug-current-bounds');
      currentBounds.setAttribute('width', '0');
      currentBounds.setAttribute('height', '0');

      const currentLabel = document.createElementNS(namespace, 'text');
      currentLabel.classList.add('dov-lpc-debug-current-label');
      currentLabel.textContent = `#${index + 1} empty`;

      group.append(safeRect, entryPath, finalAnchor, slotLabel, currentBounds, currentLabel);
      svg.append(group);
      this.debugSlots.set(slot, { currentBounds, currentLabel });
    });

    scene.append(svg);
    this.debugLayer = svg;
    this.updateDebugLayer();
  }

  private updateDebugLayer = (): void => {
    if (!this.debugEnabled || !this.debugLayer?.isConnected) {
      this.debugFrameId = null;
      return;
    }
    const scene = this.root.querySelector<HTMLElement>('.dov-scene');
    if (!scene) {
      this.debugFrameId = null;
      return;
    }
    const sceneBounds = scene.getBoundingClientRect();
    this.debugSlots.forEach(({ currentBounds, currentLabel }, slot) => {
      const character = slot.querySelector<HTMLElement>('[data-lpc-runtime-character]');
      if (!character) {
        currentBounds.style.display = 'none';
        currentLabel.style.display = 'none';
        return;
      }
      const bounds = character.getBoundingClientRect();
      const scaleX = sceneBounds.width / 780 || 1;
      const scaleY = sceneBounds.height / 650 || 1;
      const x = (bounds.left - sceneBounds.left) / scaleX;
      const y = (bounds.top - sceneBounds.top) / scaleY;
      const width = bounds.width / scaleX;
      const height = bounds.height / scaleY;
      currentBounds.style.display = '';
      currentBounds.setAttribute('x', x.toFixed(1));
      currentBounds.setAttribute('y', y.toFixed(1));
      currentBounds.setAttribute('width', width.toFixed(1));
      currentBounds.setAttribute('height', height.toFixed(1));
      currentLabel.style.display = '';
      currentLabel.setAttribute('x', (x + 5).toFixed(1));
      currentLabel.setAttribute('y', (y + height - 7).toFixed(1));
      currentLabel.textContent =
        `#${slot.dataset.dovSlot ?? '?'} ${Math.round(x)},${Math.round(y)} ` +
        `${Math.round(width)}x${Math.round(height)}`;
    });
    this.debugFrameId = window.requestAnimationFrame(this.updateDebugLayer);
  };

  private reportWarnings(slotNumber: number, playerKey: string, warnings: readonly string[]): void {
    const slot = this.slots[slotNumber - 1];
    if (slot) {
      if (warnings.length > 0) slot.dataset.lpcWarnings = warnings.join(' ');
      else delete slot.dataset.lpcWarnings;
    }
    warnings.forEach((warning) => {
      const key = `${playerKey}:${warning}`;
      if (this.warned.has(key)) return;
      this.warned.add(key);
      console.warn(`[TNX6 Dungeon LPC] Slot ${slotNumber}: ${warning}`);
    });
  }

  private failSlot(slot: HTMLElement, slotNumber: number, playerKey: string, error: unknown): void {
    this.remove(slot);
    this.failedPlayerKeys.set(slot, playerKey);
    const message = error instanceof Error ? error.message : String(error);
    const warningKey = `failure:${playerKey}:${message}`;
    if (!this.warned.has(warningKey)) {
      this.warned.add(warningKey);
      console.error(`[TNX6 Dungeon LPC] Slot ${slotNumber} fell back to equipment-v2.`, error);
    }
  }
}
