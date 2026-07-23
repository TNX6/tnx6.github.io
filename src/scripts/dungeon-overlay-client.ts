import {
  advanceDungeonRunIfDue,
  fetchActiveDungeonRun,
  fetchDungeonRunEvents,
  fetchDungeonRunSummary,
  DungeonViewerRequestError,
  parseApiTimestamp,
  type DungeonViewerActiveRun,
  type DungeonViewerEvent,
  type DungeonViewerParticipant,
  type DungeonViewerRunParticipant,
  type DungeonViewerRunSummary,
} from './dungeon-overlay-viewer';
import {
  DUNGEON_NUDGE_MAX_ATTEMPTS,
  DUNGEON_NUDGE_RETRY_MS,
  DUNGEON_NUDGE_RETRY_WINDOW_MS,
  canRetryDungeonLifecycleNudge,
  dungeonLifecycleNudgeClientAction,
  isRetryableDungeonLifecycleNudgeStatus,
} from './dungeon-overlay-nudge-policy';
import {
  hasActivePlayerAnimation,
  setPlayerAnimationState,
  type DungeonPlayerAnimationState,
} from './dungeon-overlay-animation-state';
import { DungeonSpriteAssetLoader, preloadPrimaryCharacterAssets } from './dungeon-overlay-assets';
import {
  CHARACTER_ANIMATION_CONFIG,
  DUNGEON_CHARACTER_STYLES,
  type DungeonCharacterStyle,
} from './dungeon-overlay-character-config';
import { beginDungeonTerminalFade, DUNGEON_TERMINAL_FADE_MS, formatDungeonXp } from './dungeon-overlay-presentation';
import {
  buildDungeonTerminalPresentation,
  dungeonViewerEventFeedId,
  dungeonViewerEventToFeedItem,
  DungeonEventFeedStore,
  type DungeonEventFeedIcon,
  type DungeonEventFeedItem,
  type DungeonEventFeedTone,
  type DungeonTerminalRewardRow,
} from './dungeon-overlay-feed';
import { DungeonOverlayEquipmentAdapter, type DungeonViewerVisualLoadout } from './dungeon-overlay-equipment-adapter';
import {
  decodeDungeonLayerAssetInBrowser,
  DungeonEquipmentLayerAssetLoader,
} from './dungeon-equipment-layer-preloader';

type DemoMode =
  | 'joining'
  | 'running'
  | 'completed'
  | 'failed'
  | 'sequence'
  | 'animation-red-gate'
  | 'animation-party-gate'
  | 'real-mode-regression'
  | 'joining-stability'
  | 'meta-anchor-regression'
  | 'event-feed-regression'
  | 'reward-summary-regression'
  | 'presentation-stability-regression'
  | 'equipment-integration';
type PlayerOutcome = 'survived' | 'dead';
type PlayerMotion = 'arriving' | 'returning';
type EventTone = DungeonEventFeedTone;
type EventIconKind = DungeonEventFeedIcon;

const PLAYER_MOTION_DURATION_MS: Record<PlayerMotion, number> = {
  arriving: 1_050,
  returning: 900,
};

const REAL_POLL_ACTIVE_MS = 1_000;
const REAL_POLL_IDLE_MS = 1_000;
const ACTIVE_RUN_RETRY_MS = 1_800;
const ACTIVE_RUN_GRACE_MS = 20_000;
const KNOWN_RUN_NOT_FOUND_GRACE_MS = 90_000;
const ENTRY_EVENT_FAST_POLL_MS = 500;
const ENTRY_EVENT_FAST_POLL_WINDOW_MS = 5_000;
const REAL_EVENT_DURATION_MS = 5_000;
const REAL_EVENT_GAP_MS = 400;
const REAL_FULL_PARTY_ENTRY_DELAY_MS = 120;
const REAL_TERMINAL_DURATION_MS = 12_000;
const REAL_TERMINAL_STALE_MS = 15_000;
const TERMINAL_EVENT_FEED_FADE_MS = 240;
const DEMO_EVENT_GAP_MS = 350;
const ENTRY_EVENT_READY_DELAY_MS = 600;
const PARTY_ENTRY_TRAVEL_MS = 740;
const PARTY_ENTRY_STAGGER_MS = 60;
const PARTY_ENTRY_DURATION_MS = 1_040;
const ENTRY_FX_START_DELAY_MS = PARTY_ENTRY_DURATION_MS;
const ENTRY_FX_DURATION_MS = 1_700;
const PLAYER_DEATH_DURATION_MS = 380;
const NUDGE_FAST_POLL_MS = 500;
const NUDGE_FAST_POLL_WINDOW_MS = 4_000;
const COUNTDOWN_ZERO_HOLD_MS = 120;
const BATTLE_STATUS_TEXT = 'بدأت المواجهة داخل الدنجن';

interface OverlayPlayer {
  name: string;
  level?: number | null;
  outcome?: PlayerOutcome;
  isOpener?: boolean;
  presentationKey?: string;
  restoreTerminalOutcome?: boolean;
  visualLoadout?: DungeonViewerVisualLoadout | null;
}

interface DemoPlayer extends OverlayPlayer {
  level: number;
}

interface DemoEvent {
  id?: string;
  icon: EventIconKind;
  text: string;
  tone: EventTone;
  playerSlots?: number[];
  playerName?: string;
  actionText?: string;
  isolatedText?: string;
  trailingText?: string;
}

interface DemoReward {
  player: string;
  xp: number;
  item?: string;
}

type OverlayScheduler = (delayMs: number, callback: () => void) => void;
type CharacterStateSheet = 'walkBackSheet' | 'deathSheet' | 'ghostSheet';

interface PendingPlayerPresentation {
  playerKey: string;
  player: OverlayPlayer;
  motion?: PlayerMotion;
  schedule: OverlayScheduler;
  motionDelayMs: number;
  applied: boolean;
}

interface DungeonOverlayWindow extends Window {
  __tnxDungeonOverlayCleanup?: () => void;
  __tnxDungeonEquipmentDiagnostics?: () => ReturnType<DungeonOverlayEquipmentAdapter['diagnostics']>;
}

const DEMO_MODES = new Set<DemoMode>([
  'joining',
  'running',
  'completed',
  'failed',
  'sequence',
  'animation-red-gate',
  'animation-party-gate',
  'real-mode-regression',
  'joining-stability',
  'meta-anchor-regression',
  'event-feed-regression',
  'reward-summary-regression',
  'presentation-stability-regression',
  'equipment-integration',
]);

const PLAYERS: DemoPlayer[] = [
  { name: 'تنكس', level: 1 },
  { name: 'tnx66', level: 3 },
  { name: 'خالد', level: 2 },
  { name: 'سعد', level: 4 },
  { name: 'نورا', level: 5 },
  { name: 'راشد', level: 2 },
];

const RUN_EVENTS: DemoEvent[] = [
  { icon: 'entrance', text: 'دخل الفريق إلى أعماق الدنجن.', tone: 'normal' },
  { icon: 'trap', text: 'عبر الفريق ممر الفخاخ بسلام.', tone: 'normal' },
  { icon: 'encounter', text: 'واجه تنكس وحش الظلال.', tone: 'danger', playerSlots: [1] },
  { icon: 'treasure', text: 'عثر الفريق على غرفة كنز.', tone: 'mystery' },
  { icon: 'boss', text: 'بدأ القتال ضد حارس الأعماق.', tone: 'danger' },
];

const COMPLETED_REWARDS: DemoReward[] = [
  { player: 'تنكس', xp: 85, item: 'جلد الوحش ×1' },
  { player: 'tnx66', xp: 85, item: 'شظية حديد ×1' },
];

const EQUIPMENT_COMMON_VISUAL_LOADOUT: DungeonViewerVisualLoadout = {
  weapon: { spriteKey: 'rusty-sword' },
  helmet: { spriteKey: 'leather-cap' },
  armor: { spriteKey: 'patched-leather' },
  boots: { spriteKey: 'traveler-boots' },
};

const EQUIPMENT_RARE_VISUAL_LOADOUT: DungeonViewerVisualLoadout = {
  weapon: { spriteKey: 'steel-sword' },
  helmet: { spriteKey: 'iron-helmet' },
  armor: { spriteKey: 'iron-armor' },
  boots: { spriteKey: 'guard-boots' },
};

const EQUIPMENT_EMPTY_VISUAL_LOADOUT: DungeonViewerVisualLoadout = {
  weapon: null,
  helmet: null,
  armor: null,
  boots: null,
};

const clientWindow = window as DungeonOverlayWindow;
clientWindow.__tnxDungeonOverlayCleanup?.();
const searchParams = new URLSearchParams(window.location.search);
const requestedDemo = searchParams.get('demo');
const equipmentDemoFixture = searchParams.get('fixture') ?? 'v2-empty';

const root = document.getElementById('dungeonOverlay');
const scene = document.getElementById('dungeonOverlayScene');
const notice = document.getElementById('dovJoinNotice');
const noticeText = document.getElementById('dovJoinNoticeText');
const eventFeed = document.getElementById('dovEventFeed');
const eventPanel = document.getElementById('dovEvent');
const eventIcon = document.getElementById('dovEventIcon');
const eventText = document.getElementById('dovEventText');
const statusPanel = document.getElementById('dovStatus');
const statusLabel = document.getElementById('dovStatusLabel');
const countdown = document.getElementById('dovCountdown');
const playerCount = document.getElementById('dovPlayerCount');
const resultPanel = document.getElementById('dovResult');
const resultMark = document.getElementById('dovResultMark');
const resultTitle = document.getElementById('dovResultTitle');
const resultText = document.getElementById('dovResultText');
const resultRewards = document.getElementById('dovResultRewards');
const party = document.getElementById('dovParty');
const entryFx = document.getElementById('dovEntryFx');
const battleAmbient = document.getElementById('dovBattleAmbient');
const slots = root
  ? Array.from(root.querySelectorAll<HTMLElement>('[data-dov-slot]')).sort(
      (left, right) => Number(left.dataset.dovSlot) - Number(right.dataset.dovSlot)
    )
  : [];

const elementsReady =
  root &&
  scene &&
  notice &&
  noticeText &&
  eventFeed &&
  eventPanel &&
  eventIcon &&
  eventText &&
  statusPanel &&
  statusLabel &&
  countdown &&
  playerCount &&
  resultPanel &&
  resultMark &&
  resultTitle &&
  resultText &&
  resultRewards &&
  party &&
  entryFx &&
  battleAmbient &&
  slots.length === 6;

if (elementsReady) {
  const spriteAssetLoader = new DungeonSpriteAssetLoader();
  const equipmentAssetLoader =
    requestedDemo === 'equipment-integration'
      ? new DungeonEquipmentLayerAssetLoader({
          concurrency: 5,
          decoder: async (url, timeoutMs) => {
            const failBase = equipmentDemoFixture === 'base-failure' && url.includes('/base/red/');
            const failEquipment = equipmentDemoFixture === 'equipment-failure' && url.includes('/items/leather-cap/');
            const failSteel =
              equipmentDemoFixture === 'steel-partial-failure' && url.includes('/items/steel-sword/idle-back.webp');
            if (failBase || failEquipment || failSteel)
              throw new Error('Controlled equipment integration demo failure');
            await decodeDungeonLayerAssetInBrowser(url, timeoutMs);
          },
        })
      : undefined;
  const equipmentAdapter = new DungeonOverlayEquipmentAdapter({
    initialPlayerNodeCount: slots.length,
    loader: equipmentAssetLoader,
  });
  clientWindow.__tnxDungeonEquipmentDiagnostics = () => equipmentAdapter.diagnostics();
  const eventFeedStore = new DungeonEventFeedStore();
  const primaryAssetLoads = new WeakMap<HTMLElement, Promise<boolean>>();
  const stateAssetLoads = new WeakMap<HTMLElement, Map<CharacterStateSheet, Promise<boolean>>>();
  const pendingPlayerPresentations = new WeakMap<HTMLElement, PendingPlayerPresentation>();
  slots.forEach((slot, index) => configureCharacterActor(slot, index));
  const timers = new Set<number>();
  const runTimers = new Set<number>();
  const displayedTerminalRunIds = new Set<string>();
  const processedEventKeys = new Set<string>();
  const terminalRecoveryRunIds = new Set<string>();
  const requestedDemoPlayerCount = Number(searchParams.get('players'));
  const demoPlayerCount = Number.isSafeInteger(requestedDemoPlayerCount)
    ? Math.min(6, Math.max(1, requestedDemoPlayerCount))
    : 4;
  const dungeonDebug = searchParams.get('dungeonDebug') === '1';
  const pageLoadedAt = Date.now();
  let disposed = false;
  let noticeVersion = 0;
  let eventVersion = 0;
  let demoEventId = 0;
  let entryFxVersion = 0;
  let battleAmbientVersion = 0;
  let realMode = false;
  let pollTimer: number | null = null;
  let countdownTimer: number | null = null;
  let requestController: AbortController | null = null;
  let nudgeController: AbortController | null = null;
  let pollInFlight = false;
  let immediatePollRequested = false;
  let currentRunId: string | null = null;
  let currentRunStatus: DungeonViewerActiveRun['status'] | null = null;
  let countdownDeadline: number | null = null;
  let countdownDisplayedSeconds: number | null = null;
  let countdownRunId: string | null = null;
  let countdownActiveRun: DungeonViewerActiveRun | null = null;
  let countdownZeroRunId: string | null = null;
  let countdownZeroVisibleUntil = 0;
  let serverClockOffsetMs = 0;
  let entryPresentedRunId: string | null = null;
  let entryPresentationReadyAt = 0;
  let entryEventFastPollUntil = 0;
  let entryWaitTimerScheduled = false;
  let activeRunOutageStartedAt: number | null = null;
  let knownRunNotFoundStartedAt: number | null = null;
  let knownParticipantSlots = new Set<number>();
  let joinNoticeQueue: string[] = [];
  let joinNoticeRunning = false;
  let activeJoinNotice: string | null = null;
  let eventQueue: DungeonViewerEvent[] = [];
  let eventQueueRunning = false;
  let activeQueuedEvent: DungeonViewerEvent | null = null;
  let highestEventSequence = 0;
  let eventBaselineReady = false;
  let pendingTerminalSummary: DungeonViewerRunSummary | null = null;
  let terminalPresentationRunning = false;
  let activeTerminalSummary: DungeonViewerRunSummary | null = null;
  let terminalPresentationStartedAt: number | null = null;
  let terminalPresentationRunId: string | null = null;
  let terminalPhaseStartedAt: number | null = null;
  let terminalDisplayRemainingMs = REAL_TERMINAL_DURATION_MS;
  let terminalFadeRemainingMs = DUNGEON_TERMINAL_FADE_MS;
  let terminalPhase: 'display' | 'fade' | null = null;
  let deferredActiveRun: DungeonViewerActiveRun | null = null;
  let fullPartyEntryScheduledRunId: string | null = null;
  const nudgeAttempts = new Map<string, number>();
  const nudgeStartedAt = new Map<string, number>();
  const nudgedRunIds = new Set<string>();
  const abandonedNudgeRunIds = new Set<string>();
  const debuggedFirstEventRunIds = new Set<string>();
  let nudgeFastPollUntil = 0;
  let partyEntryVersion = 0;
  let cancelTerminalFade: (() => void) | null = null;

  function debugNudge(label: string, fields: Record<string, unknown> = {}): void {
    if (!dungeonDebug) return;
    console.info(`[TNX6 Dungeon Debug] ${label}`, {
      at: new Date().toISOString(),
      ...fields,
    });
  }

  function later(delayMs: number, callback: () => void): void {
    if (disposed) return;
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delayMs);
    timers.add(timer);
  }

  function runLater(delayMs: number, callback: () => void): void {
    if (disposed || !realMode || document.hidden) return;
    const timer = window.setTimeout(() => {
      runTimers.delete(timer);
      if (!disposed && realMode) callback();
    }, delayMs);
    runTimers.add(timer);
  }

  function clearRunTimers(): void {
    runTimers.forEach((timer) => window.clearTimeout(timer));
    runTimers.clear();
    noticeVersion += 1;
    eventVersion += 1;
    joinNoticeRunning = false;
    eventQueueRunning = false;
    entryWaitTimerScheduled = false;
    fullPartyEntryScheduledRunId = null;
    cancelTerminalFade?.();
    cancelTerminalFade = null;
    hideEntryFx();
    stopBattleAmbient();
  }

  function stopCountdown(): void {
    if (countdownTimer !== null) {
      window.clearTimeout(countdownTimer);
      countdownTimer = null;
    }
    countdownDeadline = null;
    countdownDisplayedSeconds = null;
    countdownRunId = null;
    countdownActiveRun = null;
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    requestController?.abort();
    requestController = null;
    nudgeController?.abort();
    nudgeController = null;
  }

  function cleanup(): void {
    if (disposed) return;
    disposed = true;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    clearRunTimers();
    stopCountdown();
    stopPolling();
    equipmentAdapter.clear();
    window.removeEventListener('pagehide', cleanup);
    window.removeEventListener('beforeunload', cleanup);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('astro:before-swap', cleanup);
    if (clientWindow.__tnxDungeonOverlayCleanup === cleanup) {
      delete clientWindow.__tnxDungeonOverlayCleanup;
    }
    delete clientWindow.__tnxDungeonEquipmentDiagnostics;
  }

  clientWindow.__tnxDungeonOverlayCleanup = cleanup;
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);
  document.addEventListener('astro:before-swap', cleanup);

  function hideNotice(schedule: typeof later = later): void {
    const version = ++noticeVersion;
    notice.classList.remove('dov-notice--visible');
    schedule(190, () => {
      if (version === noticeVersion) {
        notice.hidden = true;
      }
    });
  }

  function showNotice(playerName: string, schedule: typeof later = later): void {
    noticeVersion += 1;
    const version = noticeVersion;
    noticeText.textContent = `${playerName} انضم إلى الفريق`;
    notice.hidden = false;
    notice.classList.remove('dov-notice--visible');
    void notice.offsetWidth;
    notice.classList.add('dov-notice--visible');
    schedule(2_000, () => {
      if (version !== noticeVersion) return;
      notice.classList.remove('dov-notice--visible');
      schedule(190, () => {
        if (version === noticeVersion) notice.hidden = true;
      });
    });
  }

  function hideEvent(schedule: typeof later = later): void {
    const version = ++eventVersion;
    eventPanel.classList.remove('dov-event--visible');
    schedule(190, () => {
      if (version === eventVersion) {
        eventPanel.hidden = true;
      }
    });
  }

  function feedItemElement(itemId: string): HTMLElement | null {
    return (
      Array.from(eventFeed.querySelectorAll<HTMLElement>('[data-feed-item-id]')).find(
        (element) => element.dataset.feedItemId === itemId
      ) ?? null
    );
  }

  function createEventFeedElement(item: DungeonEventFeedItem, visible: boolean): HTMLElement {
    const article = document.createElement('article');
    article.className = 'dov-event-feed__item';
    article.dataset.feedItemId = item.id;
    article.dataset.tone = item.tone;

    const icon = document.createElement('span');
    icon.className = 'dov-event-feed__icon';
    icon.dataset.icon = item.icon;
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('p');
    if (item.playerName && item.actionText) {
      text.dataset.layout = 'reward-xp';

      const playerName = document.createElement('bdi');
      playerName.className = 'dov-event-feed__player';
      playerName.dir = 'auto';
      playerName.textContent = item.playerName;

      const action = document.createElement('span');
      action.className = 'dov-event-feed__action';
      action.textContent = item.actionText;
      text.append(playerName, action);
    } else {
      text.append(document.createTextNode(item.text));
    }
    if (item.isolatedText) {
      const isolated = document.createElement('bdi');
      isolated.className = 'dov-event-feed__isolated';
      isolated.dir = 'ltr';
      isolated.textContent = item.isolatedText;
      text.append(isolated);
    }
    if (item.trailingText) text.append(document.createTextNode(item.trailingText));
    article.append(icon, text);
    if (visible) article.classList.add('dov-event-feed__item--visible');
    return article;
  }

  function updateEventFeedAges(): void {
    const items = eventFeedStore.values();
    items.forEach((item, index) => {
      const node = feedItemElement(item.id);
      if (node) node.dataset.feedAge = String(items.length - index - 1);
    });
  }

  function clearEventFeed(): void {
    eventFeedStore.reset();
    eventFeed.replaceChildren();
    eventFeed.hidden = true;
    eventFeed.classList.remove('dov-event-feed--hidden');
  }

  function finishHidingEventFeedForTerminal(): void {
    eventFeedStore.reset();
    eventFeed.replaceChildren();
    eventFeed.hidden = true;
  }

  function hideEventFeedForTerminal(schedule: OverlayScheduler, onHidden: () => void): void {
    const hasVisibleFeed = !eventFeed.hidden && eventFeed.childElementCount > 0;
    eventFeed.classList.add('dov-event-feed--hidden');
    if (!hasVisibleFeed) {
      finishHidingEventFeedForTerminal();
      onHidden();
      return;
    }
    schedule(TERMINAL_EVENT_FEED_FADE_MS, () => {
      finishHidingEventFeedForTerminal();
      onHidden();
    });
  }

  function forgetEventFeedItem(itemId: string): void {
    eventFeedStore.forget(itemId);
    feedItemElement(itemId)?.remove();
    updateEventFeedAges();
    if (eventFeedStore.values().length === 0) eventFeed.hidden = true;
  }

  function hydrateEventFeed(items: DungeonEventFeedItem[]): void {
    const visibleItems = eventFeedStore.hydrate(items);
    eventFeed.replaceChildren(...visibleItems.map((item) => createEventFeedElement(item, true)));
    updateEventFeedAges();
    eventFeed.classList.remove('dov-event-feed--hidden');
    eventFeed.hidden = visibleItems.length === 0;
  }

  function appendEventFeedItem(
    item: DungeonEventFeedItem,
    options: { animate?: boolean; motion?: boolean; schedule?: OverlayScheduler } = {}
  ): boolean {
    const result = eventFeedStore.append(item);
    if (!result.added) return false;
    const schedule = options.schedule ?? (realMode ? runLater : later);
    const node = createEventFeedElement(item, options.animate === false);
    eventFeed.classList.remove('dov-event-feed--hidden');
    eventFeed.hidden = false;
    eventFeed.append(node);
    updateEventFeedAges();

    if (result.removed) {
      const oldest = feedItemElement(result.removed.id);
      if (oldest) {
        oldest.classList.add('dov-event-feed__item--leaving');
        schedule(190, () => oldest.remove());
      }
    }

    if (options.animate !== false) {
      void node.offsetWidth;
      node.classList.add('dov-event-feed__item--visible');
    }
    if (options.motion !== false) {
      triggerEventMotion({
        icon: item.icon,
        text: item.text,
        tone: item.tone,
        playerSlots: item.playerSlots,
      });
    }
    return true;
  }

  function showEvent(event: DemoEvent): void {
    hideEvent(realMode ? runLater : later);
    appendEventFeedItem(
      {
        id: event.id ?? `demo:${++demoEventId}`,
        icon: event.icon,
        text: event.text,
        tone: event.tone,
        playerSlots: event.playerSlots ?? [],
        playerName: event.playerName,
        actionText: event.actionText,
        isolatedText: event.isolatedText,
        trailingText: event.trailingText,
      },
      { motion: true }
    );
  }

  function triggerEventMotion(event: DemoEvent): void {
    const schedule = realMode ? runLater : later;
    if (event.tone === 'danger' || event.tone === 'death') {
      pulseBattleAmbient(schedule);
      showEntryFx(schedule);
    } else if (event.tone === 'mystery' || event.tone === 'success' || event.tone === 'reward') {
      pulseBattleAmbient(schedule);
    }
  }

  function showBattleStatus(): void {
    if (activeQueuedEvent || eventQueueRunning || eventFeedStore.values().length > 0) return;
    eventVersion += 1;
    eventIcon.replaceChildren();
    eventIcon.dataset.icon = 'encounter';
    eventText.textContent = BATTLE_STATUS_TEXT;
    eventPanel.dataset.tone = 'danger';
    eventPanel.hidden = false;
    eventPanel.classList.remove('dov-event--visible');
    void eventPanel.offsetWidth;
    eventPanel.classList.add('dov-event--visible');
  }

  function hideEntryFx(): void {
    entryFxVersion += 1;
    entryFx.classList.remove('dov-entry-fx--active');
    entryFx.hidden = true;
  }

  function stopBattleAmbient(): void {
    battleAmbientVersion += 1;
    battleAmbient.classList.remove('dov-battle-ambient--active', 'dov-battle-ambient--impact');
    battleAmbient.hidden = true;
  }

  function startBattleAmbient(): void {
    if (!battleAmbient.hidden && battleAmbient.classList.contains('dov-battle-ambient--active')) return;
    battleAmbientVersion += 1;
    battleAmbient.hidden = false;
    battleAmbient.classList.add('dov-battle-ambient--active');
  }

  function pulseBattleAmbient(schedule: typeof later): void {
    if (battleAmbient.hidden) startBattleAmbient();
    const version = ++battleAmbientVersion;
    battleAmbient.classList.remove('dov-battle-ambient--impact');
    void battleAmbient.offsetWidth;
    battleAmbient.classList.add('dov-battle-ambient--impact');
    schedule(480, () => {
      if (version === battleAmbientVersion) battleAmbient.classList.remove('dov-battle-ambient--impact');
    });
  }

  function showEntryFx(schedule: typeof later = later): void {
    const version = ++entryFxVersion;
    entryFx.hidden = false;
    entryFx.classList.remove('dov-entry-fx--active');
    void entryFx.offsetWidth;
    entryFx.classList.add('dov-entry-fx--active');
    schedule(ENTRY_FX_DURATION_MS, () => {
      if (version !== entryFxVersion) return;
      entryFx.classList.remove('dov-entry-fx--active');
      entryFx.hidden = true;
    });
  }

  function playerActor(slot: HTMLElement): HTMLElement | null {
    return slot.querySelector<HTMLElement>('.dov-player-actor');
  }

  function configureCharacterActor(slot: HTMLElement, slotIndex: number): void {
    const actor = playerActor(slot);
    const style = DUNGEON_CHARACTER_STYLES[slotIndex];
    if (!actor || !style) return;
    const config = CHARACTER_ANIMATION_CONFIG[style];

    actor.dataset.characterStyle = style;
    actor.dataset.characterAnimated = 'true';
    actor.dataset.assetStatus = 'idle';
    actor.dataset.visualReady = 'false';
    actor.style.setProperty('--dov-character-idle-image', `url("${config.fallbackIdleImage}")`);
    actor.style.setProperty('--dov-idle-sheet', `url("${config.idleSheet}")`);
    actor.style.setProperty('--dov-walk-front-sheet', `url("${config.walkFrontSheet}")`);
    actor.style.setProperty('--dov-walk-back-sheet', `url("${config.walkBackSheet}")`);
    actor.style.setProperty('--dov-death-sheet', `url("${config.deathSheet}")`);
    actor.style.setProperty('--dov-ghost-sheet', `url("${config.ghostSheet}")`);
    actor.style.setProperty('--dov-idle-sheet-duration', `${config.durations.idle}ms`);
    actor.style.setProperty('--dov-walk-sheet-duration', `${config.durations.walk}ms`);
    actor.style.setProperty('--dov-death-sheet-duration', `${config.durations.death}ms`);
    actor.style.setProperty('--dov-ghost-sheet-duration', `${config.durations.ghost}ms`);
    actor.style.setProperty('--dov-death-meta-drop', `${config.deathMetaDrop}px`);
    actor.style.setProperty('--dov-ghost-meta-offset', `${config.ghostMetaOffset}px`);
    actor.style.setProperty('--dov-sprite-scale', String(config.spriteScale));
    actor.style.setProperty('--dov-ghost-scale', String(config.ghostScale));
    actor.style.setProperty('--dov-foot-anchor', String(config.footAnchor));
  }

  function useStaticCharacterFallback(actor: HTMLElement, fallbackUrl: string): void {
    actor.dataset.characterAnimated = 'false';
    actor.dataset.assetStatus = 'fallback';
    actor.style.setProperty('--dov-character-idle-image', `url("${fallbackUrl}")`);
  }

  function demoPrimaryAssetDelayMs(): number {
    return requestedDemo === 'real-mode-regression' ? 800 : 0;
  }

  async function ensurePrimaryActorAssets(slot: HTMLElement): Promise<boolean> {
    const actor = playerActor(slot);
    const config = characterAnimationConfig(slot);
    if (!actor || !config) return false;
    const existing = primaryAssetLoads.get(actor);
    if (existing) return existing;

    actor.dataset.assetStatus = 'loading';
    const request = preloadPrimaryCharacterAssets(spriteAssetLoader, config).then(async (mode) => {
      const demoDelayMs = demoPrimaryAssetDelayMs();
      if (demoDelayMs > 0) {
        await new Promise<void>((resolve) => later(demoDelayMs, resolve));
      }
      if (mode === 'fallback') {
        useStaticCharacterFallback(actor, config.fallbackIdleImage);
        return false;
      }
      actor.dataset.assetStatus = 'animated';
      actor.dataset.characterAnimated = 'true';
      void ensureActorStateAsset(slot, 'walkBackSheet');
      void ensureActorStateAsset(slot, 'deathSheet');
      void ensureActorStateAsset(slot, 'ghostSheet');
      return true;
    });
    primaryAssetLoads.set(actor, request);
    return request;
  }

  function ensureActorStateAsset(slot: HTMLElement, sheet: CharacterStateSheet): Promise<boolean> {
    const actor = playerActor(slot);
    const config = characterAnimationConfig(slot);
    if (!actor || !config || actor.dataset.assetStatus === 'fallback') return Promise.resolve(false);
    let requests = stateAssetLoads.get(actor);
    if (!requests) {
      requests = new Map<CharacterStateSheet, Promise<boolean>>();
      stateAssetLoads.set(actor, requests);
    }
    const existing = requests.get(sheet);
    if (existing) return existing;
    const request = spriteAssetLoader.load(config[sheet]).then((loaded) => {
      if (!loaded) useStaticCharacterFallback(actor, config.fallbackIdleImage);
      return loaded;
    });
    requests.set(sheet, request);
    return request;
  }

  function characterAnimationConfig(slot: HTMLElement) {
    const style = playerActor(slot)?.dataset.characterStyle as DungeonCharacterStyle | undefined;
    return style ? CHARACTER_ANIMATION_CONFIG[style] : null;
  }

  function playerDeathDuration(slot: HTMLElement): number {
    const config = characterAnimationConfig(slot);
    return config ? config.durations.death + config.deathHoldMs : PLAYER_DEATH_DURATION_MS;
  }

  function animationState(slot: HTMLElement): DungeonPlayerAnimationState | null {
    return (playerActor(slot)?.dataset.animationState as DungeonPlayerAnimationState | undefined) ?? null;
  }

  function setSlotAnimationState(slot: HTMLElement, state: DungeonPlayerAnimationState, restart = false): boolean {
    const actor = playerActor(slot);
    if (!actor) return false;
    if (state !== 'arriving' && state !== 'entering' && state !== 'returning' && state !== 'hit' && state !== 'dead') {
      delete actor.dataset.animationEndsAt;
    }
    const changed = setPlayerAnimationState(actor, state, restart);
    equipmentAdapter.setState(actor, state);
    return changed;
  }

  function startTransientPlayerState(
    slot: HTMLElement,
    state: Extract<DungeonPlayerAnimationState, 'arriving' | 'entering' | 'returning' | 'hit' | 'dead'>,
    nextState: DungeonPlayerAnimationState,
    durationMs: number,
    schedule: typeof later
  ): void {
    const actor = playerActor(slot);
    if (!actor) return;
    setSlotAnimationState(slot, state, true);
    actor.dataset.animationEndsAt = String(Date.now() + durationMs);
    schedule(durationMs, () => {
      if (actor.dataset.animationState !== state) return;
      delete actor.dataset.animationEndsAt;
      setSlotAnimationState(slot, nextState);
    });
  }

  function settleElapsedPlayerState(slot: HTMLElement, nextState: DungeonPlayerAnimationState): boolean {
    const actor = playerActor(slot);
    const endsAt = Number(actor?.dataset.animationEndsAt);
    if (!actor || !Number.isFinite(endsAt) || endsAt > Date.now()) return false;
    delete actor.dataset.animationEndsAt;
    setSlotAnimationState(slot, nextState);
    return true;
  }

  function hasActiveTransientPlayerState(slot: HTMLElement): boolean {
    const actor = playerActor(slot);
    return actor ? hasActivePlayerAnimation(actor) : false;
  }

  function setStatus(seconds: number, joinedPlayers: number, label = 'تبدأ الرحلة خلال', maxPlayers = 6): void {
    statusLabel.textContent = label;
    countdown.textContent = String(seconds);
    playerCount.textContent = `${joinedPlayers} / ${maxPlayers}`;
    statusPanel.hidden = false;
  }

  function hideStatus(): void {
    statusPanel.hidden = true;
  }

  function hideResult(): void {
    resultPanel.hidden = true;
    resultPanel.classList.remove('dov-result--failed');
    resultRewards.replaceChildren();
    scene.classList.remove('dov-scene--result');
  }

  function showResult(completed: boolean, description: string): void {
    stopBattleAmbient();
    finishHidingEventFeedForTerminal();
    resultPanel.classList.toggle('dov-result--failed', !completed);
    resultMark.replaceChildren();
    resultMark.dataset.result = completed ? 'success' : 'failed';
    resultTitle.textContent = completed ? 'اكتملت الرحلة' : 'فشلت الرحلة';
    resultText.textContent = description;
    resultPanel.hidden = false;
    scene.classList.add('dov-scene--result');
    root.classList.remove('dov-overlay--running');
    root.classList.add('dov-overlay--terminal');
  }

  function renderTerminalRewardRows(rows: DungeonTerminalRewardRow[]): void {
    const fragment = document.createDocumentFragment();

    const header = document.createElement('div');
    header.className = 'dov-result-reward-header';
    const columnLabels = [
      ['name', 'الاسم'],
      ['status', 'الحالة'],
      ['xp', 'XP'],
      ['materials', 'الغنائم'],
    ] as const;
    columnLabels.forEach(([column, label]) => {
      const cell = document.createElement('span');
      cell.className = `dov-result-reward-header__${column}`;
      cell.textContent = label;
      if (column === 'xp') cell.dir = 'ltr';
      header.append(cell);
    });
    fragment.append(header);

    rows.forEach((row) => {
      const item = document.createElement('article');
      item.className = 'dov-result-reward';
      item.dataset.status = row.status === 'مات' ? 'dead' : row.status === 'نجا' ? 'survived' : 'unknown';

      const name = document.createElement('strong');
      name.className = 'dov-result-reward__name';
      name.textContent = row.displayName;

      const status = document.createElement('span');
      status.className = 'dov-result-reward__status';
      status.textContent = row.status ?? '';
      status.hidden = !row.status;

      const xp = document.createElement('bdi');
      xp.className = 'dov-result-reward__xp';
      xp.dir = 'ltr';
      xp.textContent = row.xpText ?? '';
      xp.hidden = !row.xpText;

      const materials = document.createElement('span');
      materials.className = 'dov-result-reward__materials';
      materials.textContent = row.materials.join('، ');
      materials.hidden = row.materials.length === 0;

      item.append(name, status, xp, materials);
      fragment.append(item);
    });
    resultRewards.replaceChildren(fragment);
  }

  function hideRewards(): void {
    slots.forEach((slot) => {
      slot.querySelector<HTMLElement>('.dov-slot__reward')?.replaceChildren();
    });
  }

  function showRewards(rewards: DemoReward[]): void {
    hideRewards();
    rewards.forEach((reward) => {
      const playerSlot = slots.find(
        (slot) => slot.querySelector<HTMLElement>('.dov-slot__name')?.textContent === reward.player
      );
      const rewardTarget = playerSlot?.querySelector<HTMLElement>('.dov-slot__reward');
      if (!rewardTarget) return;

      const item = document.createElement('article');
      item.className = 'dov-reward';

      const name = document.createElement('strong');
      name.textContent = reward.player;
      const xp = document.createElement('span');
      xp.className = 'dov-reward__xp';
      xp.dir = 'ltr';
      xp.textContent = formatDungeonXp(reward.xp);
      item.append(name, xp);

      if (reward.item) {
        const material = document.createElement('span');
        material.textContent = reward.item;
        item.append(material);
      }

      rewardTarget.replaceChildren(item);
    });
  }

  function updatePartyLayout(): void {
    const activeSlots = slots.filter((slot) => !slot.classList.contains('dov-slot--empty'));
    const playerTotal = activeSlots.length;
    const frontRowSize = playerTotal <= 3 ? playerTotal : playerTotal === 4 ? 2 : 3;

    party.dataset.playerCount = String(playerTotal);
    activeSlots.forEach((slot, index) => {
      const isFront = playerTotal === 6 ? Number(slot.dataset.dovSlot || 0) % 2 === 1 : index < frontRowSize;

      slot.classList.toggle('dov-slot--front', isFront);
      slot.classList.toggle('dov-slot--rear', !isFront);
    });
  }

  function resetSlot(slot: HTMLElement): void {
    const actor = playerActor(slot);
    if (actor) equipmentAdapter.remove(actor);
    slot.className = 'dov-slot dov-slot--empty';
    slot.setAttribute('aria-label', `المقعد ${slot.dataset.dovSlot || ''} فارغ`);
    const name = slot.querySelector<HTMLElement>('.dov-slot__name');
    const level = slot.querySelector<HTMLElement>('.dov-slot__level');
    const state = slot.querySelector<HTMLElement>('.dov-slot__state');
    const reward = slot.querySelector<HTMLElement>('.dov-slot__reward');
    if (name) name.textContent = '';
    if (level) {
      level.textContent = '';
      level.hidden = false;
    }
    if (state) state.textContent = '';
    if (reward) reward.replaceChildren();
    if (actor) {
      actor.style.removeProperty('--dov-entry-stagger');
      actor.style.removeProperty('--dov-return-stagger');
      delete actor.dataset.animationEndsAt;
      delete actor.dataset.playerKey;
      delete actor.dataset.requestedOutcome;
      delete actor.dataset.deathAssetPending;
      actor.dataset.visualReady = 'false';
      pendingPlayerPresentations.delete(actor);
      setSlotAnimationState(slot, 'inside');
    }
  }

  function revealGhostWhenReady(slot: HTMLElement): void {
    const actor = playerActor(slot);
    if (!actor || actor.dataset.deathAssetPending === 'ghost') return;
    actor.dataset.deathAssetPending = 'ghost';
    void ensureActorStateAsset(slot, 'ghostSheet').then(() => {
      if (actor.dataset.deathAssetPending === 'ghost') delete actor.dataset.deathAssetPending;
      if (actor.dataset.requestedOutcome !== 'dead' || animationState(slot) !== 'dead') return;
      delete actor.dataset.animationEndsAt;
      setSlotAnimationState(slot, 'ghost');
    });
  }

  function startDeathWhenReady(slot: HTMLElement, schedule: OverlayScheduler): void {
    const actor = playerActor(slot);
    if (!actor) return;
    const currentState = animationState(slot);
    if (currentState === 'ghost') return;
    if (currentState === 'dead') {
      if (!hasActiveTransientPlayerState(slot)) revealGhostWhenReady(slot);
      return;
    }
    if (actor.dataset.deathAssetPending === 'death') return;
    actor.dataset.deathAssetPending = 'death';
    void ensureActorStateAsset(slot, 'deathSheet').then(() => {
      if (actor.dataset.deathAssetPending === 'death') delete actor.dataset.deathAssetPending;
      if (actor.dataset.requestedOutcome !== 'dead' || animationState(slot) === 'ghost') return;
      const durationMs = playerDeathDuration(slot);
      setSlotAnimationState(slot, 'dead', true);
      actor.dataset.animationEndsAt = String(Date.now() + durationMs);
      schedule(durationMs, () => revealGhostWhenReady(slot));
    });
  }

  function applyReadyPlayerState(
    slot: HTMLElement,
    player: OverlayPlayer,
    motion: PlayerMotion | undefined,
    schedule: OverlayScheduler,
    motionDelayMs: number
  ): void {
    const actor = playerActor(slot);
    if (!actor) return;
    const currentState = animationState(slot);
    if (player.outcome === 'dead') {
      actor.dataset.requestedOutcome = 'dead';
      if (player.restoreTerminalOutcome) {
        void ensureActorStateAsset(slot, 'ghostSheet').then(() => {
          if (actor.dataset.requestedOutcome === 'dead') setSlotAnimationState(slot, 'ghost');
        });
        return;
      }
      startDeathWhenReady(slot, schedule);
      return;
    }
    delete actor.dataset.requestedOutcome;

    if (motion) {
      if (motion === 'returning') actor.style.setProperty('--dov-return-stagger', `${motionDelayMs}ms`);
      startTransientPlayerState(slot, motion, 'idle', PLAYER_MOTION_DURATION_MS[motion] + motionDelayMs, schedule);
      return;
    }
    if (hasActiveTransientPlayerState(slot)) return;
    if (currentState === 'arriving' || currentState === 'returning') {
      settleElapsedPlayerState(slot, 'idle');
    } else if (currentState === 'entering') {
      settleElapsedPlayerState(slot, 'inside');
    } else if (currentState !== 'hit' && currentState !== 'dead' && currentState !== 'ghost') {
      setSlotAnimationState(slot, 'idle');
    }
  }

  function requestPlayerPresentation(
    slot: HTMLElement,
    slotIndex: number,
    player: OverlayPlayer,
    motion: PlayerMotion | undefined,
    schedule: OverlayScheduler,
    motionDelayMs: number
  ): void {
    const actor = playerActor(slot);
    if (!actor) return;
    const playerKey = player.presentationKey ?? `demo:slot:${slotIndex + 1}`;
    const changedPlayer = actor.dataset.playerKey !== playerKey;
    if (changedPlayer) {
      actor.dataset.playerKey = playerKey;
      actor.dataset.visualReady = 'false';
      pendingPlayerPresentations.delete(actor);
    }

    const visualLoadoutPresent = Object.prototype.hasOwnProperty.call(player, 'visualLoadout');
    const figure = slot.querySelector<HTMLElement>('.dov-player-figure');
    const legacyAvatar = slot.querySelector<HTMLElement>('.dov-avatar');
    const runId = player.presentationKey?.split(':slot:')[0] ?? currentRunId ?? 'demo';

    if (actor.dataset.visualReady === 'true') {
      if (figure && legacyAvatar) {
        void equipmentAdapter.reconcile({
          runId,
          slotNumber: slotIndex + 1,
          playerActor: actor,
          figure,
          legacyAvatar,
          visualLoadoutPresent,
          visualLoadout: player.visualLoadout,
        });
      }
      applyReadyPlayerState(slot, player, motion, schedule, motionDelayMs);
      return;
    }

    const pending = pendingPlayerPresentations.get(actor);
    if (pending?.playerKey === playerKey && pending.motion === 'arriving' && motion === undefined) return;
    pendingPlayerPresentations.set(actor, {
      playerKey,
      player,
      motion,
      schedule,
      motionDelayMs,
      applied: false,
    });

    const applyPendingPresentation = (consume: boolean): void => {
      const queued = pendingPlayerPresentations.get(actor);
      if (!queued || queued.playerKey !== actor.dataset.playerKey || slot.classList.contains('dov-slot--empty')) return;
      if (!queued.applied) {
        applyReadyPlayerState(slot, queued.player, queued.motion, queued.schedule, queued.motionDelayMs);
        queued.applied = true;
      }
      if (consume) pendingPlayerPresentations.delete(actor);
      actor.dataset.visualReady = 'true';
    };

    const legacyReady = ensurePrimaryActorAssets(slot);
    const rendererReady =
      figure && legacyAvatar
        ? equipmentAdapter.reconcile({
            runId,
            slotNumber: slotIndex + 1,
            playerActor: actor,
            figure,
            legacyAvatar,
            visualLoadoutPresent,
            visualLoadout: player.visualLoadout,
          })
        : Promise.resolve<'legacy'>('legacy');

    void legacyReady.then(() => {
      const record = equipmentAdapter.recordFor(actor);
      applyPendingPresentation(!record || record.requestedMode === 'legacy' || record.baseFailed);
    });
    void rendererReady.then((mode) => {
      if (mode === 'layered') applyPendingPresentation(true);
      else void legacyReady.then(() => applyPendingPresentation(true));
    });
  }

  function setPlayer(
    slotIndex: number,
    player: OverlayPlayer,
    motion?: PlayerMotion,
    schedule: typeof later = later,
    motionDelayMs = 0
  ): void {
    const slot = slots[slotIndex];
    if (!slot) return;
    slot.classList.remove('dov-slot--empty');
    slot.classList.toggle('dov-slot--opener', player.isOpener ?? slotIndex === 0);
    slot.classList.toggle('dov-slot--survived', player.outcome === 'survived');
    slot.classList.toggle('dov-slot--dead', player.outcome === 'dead');
    const playerLevel = Number.isSafeInteger(player.level) && Number(player.level) > 0 ? Number(player.level) : null;
    const levelLabel = playerLevel === null ? '' : `، المستوى ${playerLevel}`;
    slot.setAttribute('aria-label', `${player.name}${levelLabel}${player.outcome === 'dead' ? '، مات' : ''}`);

    const name = slot.querySelector<HTMLElement>('.dov-slot__name');
    const level = slot.querySelector<HTMLElement>('.dov-slot__level');
    const state = slot.querySelector<HTMLElement>('.dov-slot__state');
    if (name) name.textContent = player.name;
    if (level) {
      level.hidden = playerLevel === null;
      level.textContent = playerLevel === null ? '' : `LV ${playerLevel}`;
    }
    if (state) state.textContent = player.outcome === 'dead' ? 'مات' : player.outcome === 'survived' ? 'نجا' : '';

    requestPlayerPresentation(slot, slotIndex, player, motion, schedule, motionDelayMs);
    updatePartyLayout();
  }

  function setPlayers(players: OverlayPlayer[], motion?: PlayerMotion, schedule: typeof later = later): void {
    slots.forEach(resetSlot);
    players
      .slice(0, slots.length)
      .forEach((player, index) =>
        setPlayer(index, player, motion, schedule, motion === 'returning' ? index * PARTY_ENTRY_STAGGER_MS : 0)
      );
    updatePartyLayout();
    party.classList.remove('dov-party--inside');
  }

  async function sendPartyInside(schedule: OverlayScheduler = later): Promise<number | null> {
    const version = ++partyEntryVersion;
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    stopBattleAmbient();
    const activeSlots = slots.filter((slot) => !slot.classList.contains('dov-slot--empty'));
    await Promise.all(activeSlots.map((slot) => ensureActorStateAsset(slot, 'walkBackSheet')));
    if (disposed || version !== partyEntryVersion) return null;
    const startedAt = Date.now();
    activeSlots.forEach((slot, index) => {
      const actor = playerActor(slot);
      actor?.style.setProperty('--dov-entry-stagger', `${index * PARTY_ENTRY_STAGGER_MS}ms`);
      actor?.style.setProperty('--dov-entry-duration', `${PARTY_ENTRY_TRAVEL_MS}ms`);
      startTransientPlayerState(slot, 'entering', 'inside', PARTY_ENTRY_DURATION_MS, schedule);
    });
    party.classList.add('dov-party--inside');
    schedule(ENTRY_FX_START_DELAY_MS, () => {
      startBattleAmbient();
      showEntryFx(schedule);
      showBattleStatus();
    });
    return startedAt;
  }

  function resetScene(): void {
    partyEntryVersion += 1;
    root.classList.remove(
      'dov-overlay--visible',
      'dov-overlay--fading',
      'dov-overlay--leaving',
      'dov-overlay--running',
      'dov-overlay--terminal',
      'dov-overlay--instant'
    );
    notice.hidden = true;
    notice.classList.remove('dov-notice--visible');
    eventPanel.hidden = true;
    eventPanel.classList.remove('dov-event--visible');
    clearEventFeed();
    hideEntryFx();
    stopBattleAmbient();
    hideStatus();
    hideResult();
    hideRewards();
    setPlayers([]);
  }

  function fadeOut(delayMs: number): void {
    later(delayMs, () => {
      cancelTerminalFade?.();
      cancelTerminalFade = beginDungeonTerminalFade(root, later, () => {
        cancelTerminalFade = null;
        root.hidden = true;
        root.classList.remove('dov-overlay--visible', 'dov-overlay--leaving');
      });
    });
  }

  function runJoiningDemo(): void {
    const players = PLAYERS.slice(0, demoPlayerCount);
    setPlayers(players);
    setStatus(43, players.length);
    showNotice('تنكس');
  }

  function runRunningDemo(): void {
    setPlayers(PLAYERS.slice(0, demoPlayerCount));
    later(120, sendPartyInside);
    scheduleDemoEvents(120 + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_READY_DELAY_MS);
  }

  function runCompletedDemo(): void {
    const players = PLAYERS.slice(0, demoPlayerCount).map((player, index) => ({
      ...player,
      outcome: index < Math.min(2, demoPlayerCount) ? ('survived' as const) : ('dead' as const),
    }));
    setPlayers(players, 'returning');
    showResult(true, 'عثر الناجون على غنائم داخل الدنجن.');
    showRewards(COMPLETED_REWARDS);
    fadeOut(REAL_TERMINAL_DURATION_MS);
  }

  function runFailedDemo(): void {
    const defeatedPlayers = PLAYERS.slice(0, demoPlayerCount).map((player) => ({
      ...player,
      outcome: 'dead' as const,
    }));
    setPlayers(defeatedPlayers, 'returning');
    showResult(false, 'لم يتمكن الفريق من إكمال الدنجن.');
    hideRewards();
    fadeOut(REAL_TERMINAL_DURATION_MS);
  }

  function runAnimationRedGateDemo(): void {
    const redPlayer = { ...PLAYERS[0], isOpener: true };
    setPlayers([]);

    later(2_000, () => setPlayer(0, redPlayer, 'arriving'));
    later(5_500, () => sendPartyInside());
    later(7_500, () => {
      hideEntryFx();
      stopBattleAmbient();
      setPlayer(0, redPlayer, 'returning');
    });
    later(10_000, () => setPlayer(0, { ...redPlayer, outcome: 'dead' }));
  }

  function runAnimationPartyGateDemo(): void {
    const partyPlayers = PLAYERS.map((player, index) => ({ ...player, isOpener: index === 0 }));
    setPlayers([]);

    partyPlayers.forEach((player, index) => {
      later(2_000 + index * 360, () => setPlayer(index, player, 'arriving'));
    });

    later(7_000, () => sendPartyInside());
    later(9_000, () => showEvent(RUN_EVENTS[0]));
    later(10_800, () => hideEvent());
    later(11_000, () => {
      partyPlayers.forEach((player, index) => {
        setPlayer(index, index < 3 ? { ...player, outcome: 'survived' } : player, 'returning', later, index * 60);
      });
    });
    later(14_000, () => {
      partyPlayers.slice(3).forEach((player, index) => setPlayer(index + 3, { ...player, outcome: 'dead' }));
    });
    later(18_800, () => {
      partyPlayers.slice(0, 3).forEach((player, index) => setPlayer(index, { ...player, outcome: 'dead' }));
    });
    later(20_000, () => {
      showResult(false, 'لم يتمكن الفريق من إكمال الدنجن.');
      hideRewards();
    });
  }

  function runRealModeRegressionDemo(): void {
    const player = { ...PLAYERS[0], isOpener: true };
    setPlayers([]);
    setStatus(6, 0);

    later(100, () => {
      setPlayer(0, player, 'arriving');
      setStatus(6, 1);
    });
    for (let second = 1; second <= 6; second += 1) {
      later(second * 1_000, () => {
        setPlayer(0, player);
        setStatus(Math.max(0, 6 - second), 1);
      });
    }
    later(7_000, () => {
      hideStatus();
      void sendPartyInside();
    });
    later(8_650, () =>
      showEvent({ icon: 'boss', text: 'صمد حارس الأعماق أمام الفريق.', tone: 'danger', playerSlots: [1] })
    );
    later(8_650 + REAL_EVENT_DURATION_MS, () => {
      hideEvent();
      setPlayer(0, { ...player, outcome: 'dead' });
    });
    later(14_650, () => {
      showResult(false, 'لم يتمكن الفريق من إكمال الدنجن.');
      showRewards([{ player: player.name, xp: 65 }]);
    });
    fadeOut(17_200);
  }

  function runJoiningStabilityDemo(): void {
    const player = { ...PLAYERS[0], isOpener: true };
    setPlayers([]);
    setStatus(120, 0);
    later(100, () => {
      setPlayer(0, player, 'arriving');
      setStatus(120, 1);
      showNotice(player.name);
    });
    for (let poll = 1; poll <= 14; poll += 1) {
      later(poll * 1_000, () => {
        setPlayer(0, player);
        setStatus(120 - poll, 1);
      });
    }
  }

  function runMetaAnchorRegressionDemo(): void {
    const player = { ...PLAYERS[0], isOpener: true };
    setPlayers([]);

    later(300, () => setPlayer(0, player, 'arriving'));
    later(2_300, () => setPlayer(0, player));
    later(3_300, () => sendPartyInside());
    later(4_500, () => hideEvent());
    later(4_800, () => setPlayer(0, player, 'returning'));
    later(6_400, () => setPlayer(0, { ...player, outcome: 'dead' }));
  }

  function demoRewardSummary(runId: string): DungeonViewerRunSummary {
    const participants: DungeonViewerRunParticipant[] = PLAYERS.map((player, index) => ({
      slotNumber: index + 1,
      displayName: player.name,
      level: player.level,
      status: index < 4 ? 'survived' : 'dead',
      survived: index < 4,
      isOpener: index === 0,
    }));
    return {
      id: runId,
      status: 'completed',
      serverNow: new Date().toISOString(),
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      completedAt: new Date().toISOString(),
      result: 'completed',
      participants,
      rewards: [
        {
          displayName: 'تنكس',
          xp: 65,
          materials: [
            { itemName: 'شظية حديد', quantity: 1 },
            { itemName: 'خشب الكهف', quantity: 1 },
          ],
        },
        { displayName: 'tnx66', xp: 80, materials: [] },
        { displayName: 'خالد', xp: 55, materials: [{ itemName: 'جلد الوحش', quantity: 1 }] },
        { displayName: 'سعد', xp: 45, materials: [] },
        { displayName: 'نورا', xp: 20, materials: [] },
      ],
    };
  }

  function presentDemoTerminalSummary(summary: DungeonViewerRunSummary): void {
    const terminal = buildDungeonTerminalPresentation(summary);
    hideEventFeedForTerminal(later, () => {
      renderTerminalRewardRows(terminal.rows);
      showResult(!isFailedTerminal(summary), terminal.description);
    });
  }

  function runPresentationStabilityRegressionDemo(): void {
    const players = PLAYERS.slice(0, 2).map((player, index) => ({ ...player, isOpener: index === 0 }));
    setPlayers(players);
    setStatus(15, players.length);

    for (let poll = 1; poll <= 30; poll += 1) {
      later(poll * 500, () => {
        players.forEach((player, index) => setPlayer(index, player));
        setStatus(Math.max(0, 15 - Math.floor(poll / 2)), players.length);
      });
    }

    const entryStartsAt = 15_500;
    later(entryStartsAt, () => {
      hideStatus();
      void sendPartyInside();
    });
    const eventStartsAt = entryStartsAt + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_READY_DELAY_MS;
    const interval = REAL_EVENT_DURATION_MS + DEMO_EVENT_GAP_MS;
    RUN_EVENTS.slice(0, 4).forEach((event, index) => {
      const showAt = eventStartsAt + index * interval;
      later(showAt, () => showEvent(event));
      later(showAt + REAL_EVENT_DURATION_MS, () => hideEvent());
    });
    const terminalAt = eventStartsAt + 4 * interval;
    later(terminalAt, () => {
      players.forEach((player, index) =>
        setPlayer(index, { ...player, outcome: index === 0 ? 'survived' : 'dead' }, 'returning', later)
      );
      const summary = demoRewardSummary('presentation-stability-regression');
      summary.participants = summary.participants.slice(0, 2);
      summary.rewards = summary.rewards.slice(0, 2);
      presentDemoTerminalSummary(summary);
    });
    fadeOut(terminalAt + REAL_TERMINAL_DURATION_MS + TERMINAL_EVENT_FEED_FADE_MS);
  }

  function runEventFeedRegressionDemo(): void {
    const players = PLAYERS.slice(0, 4).map((player, index) => ({ ...player, isOpener: index === 0 }));
    const events: DemoEvent[] = [
      { id: 'feed-demo:1', icon: 'entrance', text: 'دخل الفريق إلى أعماق الدنجن.', tone: 'normal' },
      { id: 'feed-demo:2', icon: 'trap', text: 'tnx66 وقع في فخ حجري.', tone: 'danger', playerSlots: [2] },
      { id: 'feed-demo:3', icon: 'encounter', text: 'نورا نجت من مواجهة خطرة.', tone: 'success', playerSlots: [3] },
      { id: 'feed-demo:4', icon: 'treasure', text: 'خالد عثر على صندوق قديم.', tone: 'mystery', playerSlots: [3] },
      { id: 'feed-demo:5', icon: 'boss', text: 'سعد مات أثناء حماية الفريق.', tone: 'death', playerSlots: [4] },
      {
        id: 'feed-demo:6',
        icon: 'treasure',
        text: 'tnx66 حصل على +80 XP',
        playerName: 'tnx66',
        actionText: 'حصل على',
        isolatedText: '+80 XP',
        tone: 'reward',
      },
      { id: 'feed-demo:7', icon: 'treasure', text: 'تنكس حصل على شظية حديد ×1.', tone: 'reward' },
    ];

    setPlayers(players);
    later(700, () => void sendPartyInside());
    events.forEach((event, index) => later(2_400 + index * 3_100, () => showEvent(event)));
    later(24_000, () => {
      const terminalPlayers = players.map((player, index) => ({
        ...player,
        outcome: index < 3 ? ('survived' as const) : ('dead' as const),
      }));
      setPlayers(terminalPlayers, 'returning');
      const summary = demoRewardSummary('event-feed-regression');
      summary.participants = summary.participants.slice(0, 4).map((participant, index) => ({
        ...participant,
        survived: index < 3,
        status: index < 3 ? 'survived' : 'dead',
      }));
      summary.rewards = summary.rewards.filter((reward) =>
        summary.participants.some((participant) => participant.displayName === reward.displayName)
      );
      presentDemoTerminalSummary(summary);
    });
    fadeOut(30_000);
  }

  function runRewardSummaryRegressionDemo(): void {
    const summary = demoRewardSummary('reward-summary-regression');
    const terminalPlayers = PLAYERS.map((player, index) => ({
      ...player,
      isOpener: index === 0,
      outcome: index < 4 ? ('survived' as const) : ('dead' as const),
    }));
    setPlayers(terminalPlayers, 'returning');
    later(900, () => presentDemoTerminalSummary(summary));
    fadeOut(14_000);
  }

  function equipmentDemoLoadout(fixture: string, slotIndex: number): DungeonViewerVisualLoadout | null | undefined {
    if (fixture === 'v1-legacy') return undefined;
    if (fixture === 'partial-fallback' && slotIndex === 0) return null;
    if (fixture === 'v2-empty') return EQUIPMENT_EMPTY_VISUAL_LOADOUT;
    if (fixture === 'v2-full-rare' || fixture === 'steel-partial-failure') {
      return EQUIPMENT_RARE_VISUAL_LOADOUT;
    }
    if (fixture === 'v2-mixed') {
      return slotIndex % 2 === 0
        ? {
            weapon: EQUIPMENT_RARE_VISUAL_LOADOUT.weapon,
            helmet: EQUIPMENT_COMMON_VISUAL_LOADOUT.helmet,
            armor: EQUIPMENT_RARE_VISUAL_LOADOUT.armor,
            boots: null,
          }
        : {
            weapon: EQUIPMENT_COMMON_VISUAL_LOADOUT.weapon,
            helmet: null,
            armor: EQUIPMENT_COMMON_VISUAL_LOADOUT.armor,
            boots: EQUIPMENT_RARE_VISUAL_LOADOUT.boots,
          };
    }
    return EQUIPMENT_COMMON_VISUAL_LOADOUT;
  }

  function runEquipmentIntegrationDemo(): void {
    const fixture = equipmentDemoFixture;
    const requestedState = searchParams.get('equipmentState') ?? 'registration';
    const players: OverlayPlayer[] = PLAYERS.map((player, index) => {
      const visualLoadout = equipmentDemoLoadout(fixture, index);
      return {
        ...player,
        isOpener: index === 0,
        presentationKey: `equipment-${fixture}:slot:${index + 1}`,
        ...(visualLoadout !== undefined ? { visualLoadout } : {}),
      };
    });

    scene.dataset.equipmentFixture = fixture;
    scene.dataset.equipmentState = requestedState;
    setPlayers(players);
    setStatus(28, players.length);

    const showInsideEffects = (): void => {
      hideStatus();
      root.classList.add('dov-overlay--running');
      slots.forEach((slot) => setSlotAnimationState(slot, 'inside'));
      party.classList.add('dov-party--inside');
      startBattleAmbient();
      showEntryFx();
    };

    if (fixture === 'running-recovery' || requestedState === 'inside') {
      later(1_000, showInsideEffects);
      return;
    }

    if (fixture === 'terminal-recovery' || requestedState === 'terminal') {
      later(1_000, () => {
        const terminalPlayers = players.map((player, index) => ({
          ...player,
          outcome: index < 3 ? ('survived' as const) : ('dead' as const),
          restoreTerminalOutcome: index >= 3,
        }));
        setPlayers(terminalPlayers);
        showResult(true, 'اكتملت الرحلة مع تجهيزات Snapshot المجمدة.');
      });
      return;
    }

    if (requestedState === 'entering') {
      later(1_000, () => {
        hideStatus();
        void sendPartyInside();
      });
      return;
    }

    if (requestedState === 'returning') {
      later(900, showInsideEffects);
      later(1_450, () => {
        players.forEach((player, index) =>
          setPlayer(index, player, 'returning', later, index * PARTY_ENTRY_STAGGER_MS)
        );
      });
      return;
    }

    if (requestedState === 'death') {
      later(1_000, () => {
        hideStatus();
        slots.forEach((slot) => setSlotAnimationState(slot, 'dead'));
      });
      return;
    }

    if (requestedState === 'ghost') {
      later(1_000, () => {
        hideStatus();
        slots.forEach((slot) => setSlotAnimationState(slot, 'ghost'));
      });
      return;
    }

    if (requestedState === 'full-sequence') {
      later(900, () => {
        hideStatus();
        void sendPartyInside();
      });
      later(2_650, () => showEvent(RUN_EVENTS[0]));
      later(4_450, () => {
        hideEvent();
        players.forEach((player, index) => {
          setPlayer(
            index,
            {
              ...player,
              outcome: index < 3 ? ('survived' as const) : ('dead' as const),
            },
            'returning',
            later,
            index * PARTY_ENTRY_STAGGER_MS
          );
        });
      });
      later(6_200, () => showResult(true, 'اكتملت الرحلة مع التجهيزات المرئية.'));
    }
  }

  function runSequenceDemo(): void {
    const sequencePlayers = PLAYERS.slice(0, demoPlayerCount);
    const joinMoments = sequencePlayers.map((_, index) => 500 + index * 2_300);
    joinMoments.forEach((moment, index) => {
      later(moment, () => {
        setPlayer(index, sequencePlayers[index], 'arriving');
        showNotice(sequencePlayers[index].name);
      });
    });

    const countdownStartsAt = (joinMoments.at(-1) ?? 500) + 1_800;
    later(countdownStartsAt, () => setStatus(10, sequencePlayers.length));
    for (let elapsed = 1; elapsed <= 10; elapsed += 1) {
      later(countdownStartsAt + elapsed * 1_000, () => {
        countdown.textContent = String(10 - elapsed);
        if (elapsed === 10) {
          hideNotice();
          hideStatus();
          sendPartyInside();
        }
      });
    }

    const entryStartsAt = countdownStartsAt + 10_000;
    const terminalAt = scheduleDemoEvents(entryStartsAt + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_READY_DELAY_MS);
    later(terminalAt, () => {
      showResult(true, 'عثر الناجون على غنائم داخل الدنجن.');
    });

    later(terminalAt + 1_400, () => {
      const terminalPlayers = sequencePlayers.map((player, index) => ({
        ...player,
        outcome: index < Math.min(2, sequencePlayers.length) ? ('survived' as const) : ('dead' as const),
      }));
      setPlayers(terminalPlayers, 'returning');
    });

    later(terminalAt + 3_000, () => showRewards(COMPLETED_REWARDS));
    fadeOut(terminalAt + REAL_TERMINAL_DURATION_MS);
  }

  function scheduleDemoEvents(startAt: number): number {
    const interval = REAL_EVENT_DURATION_MS + DEMO_EVENT_GAP_MS;
    RUN_EVENTS.forEach((event, index) => {
      const showAt = startAt + index * interval;
      later(showAt, () => showEvent(event));
      later(showAt + REAL_EVENT_DURATION_MS, () => hideEvent());
    });
    return startAt + RUN_EVENTS.length * interval;
  }

  function revealRealOverlay(immediate = false): void {
    cancelTerminalFade?.();
    cancelTerminalFade = null;
    root.hidden = false;
    root.classList.remove('dov-overlay--fading', 'dov-overlay--leaving');
    if (immediate) root.classList.add('dov-overlay--instant');
    if (!root.classList.contains('dov-overlay--visible')) {
      if (!immediate) void root.offsetWidth;
      root.classList.add('dov-overlay--visible');
    }
    if (immediate) {
      later(0, () => root.classList.remove('dov-overlay--instant'));
    }
  }

  function concealRealOverlay(): void {
    root.hidden = true;
    root.classList.remove('dov-overlay--visible', 'dov-overlay--fading', 'dov-overlay--leaving');
  }

  function stopJoiningCountdown(): void {
    stopCountdown();
  }

  function isBattleStatusVisible(): boolean {
    return !eventPanel.hidden && eventText.textContent === BATTLE_STATUS_TEXT;
  }

  function hasKnownRunRecoveryContext(): boolean {
    return Boolean(
      currentRunId &&
        !displayedTerminalRunIds.has(currentRunId) &&
        (entryPresentedRunId === currentRunId ||
          currentRunStatus === 'running' ||
          isBattleStatusVisible() ||
          activeQueuedEvent ||
          eventQueue.length > 0 ||
          pendingTerminalSummary?.id === currentRunId ||
          activeTerminalSummary?.id === currentRunId ||
          terminalPresentationRunning)
    );
  }

  function knownRunPollDelay(): number {
    return entryPresentedRunId === currentRunId && Date.now() < entryEventFastPollUntil
      ? ENTRY_EVENT_FAST_POLL_MS
      : REAL_POLL_ACTIVE_MS;
  }

  function keepKnownRunVisible(): void {
    stopJoiningCountdown();
    hideStatus();
    if (terminalPresentationRunning || activeTerminalSummary) {
      revealRealOverlay();
      return;
    }
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    party.classList.add('dov-party--inside');
    const entryInProgress = slots.some(
      (slot) => animationState(slot) === 'entering' && hasActiveTransientPlayerState(slot)
    );
    if (entryInProgress) {
      revealRealOverlay();
      return;
    }
    if (!activeQueuedEvent && !eventQueueRunning && !terminalPresentationRunning && !activeTerminalSummary) {
      showBattleStatus();
    }
    revealRealOverlay();
  }

  async function recoverKnownRun(signal: AbortSignal): Promise<number | null> {
    const runId = currentRunId;
    if (!runId || !hasKnownRunRecoveryContext()) return null;

    keepKnownRunVisible();
    let summary: DungeonViewerRunSummary;
    try {
      summary = await fetchDungeonRunSummary(runId, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof DungeonViewerRequestError && error.status === 404) {
        knownRunNotFoundStartedAt ??= Date.now();
        if (Date.now() - knownRunNotFoundStartedAt >= KNOWN_RUN_NOT_FOUND_GRACE_MS) {
          resetRealRunState(null);
          concealRealOverlay();
          return REAL_POLL_IDLE_MS;
        }
      } else {
        knownRunNotFoundStartedAt = null;
      }
      return knownRunPollDelay();
    }

    if (summary.id !== currentRunId) return knownRunPollDelay();
    knownRunNotFoundStartedAt = null;
    updateServerClock(summary.serverNow);
    currentRunStatus = summary.status;

    let events: DungeonViewerEvent[] | null = null;
    try {
      events = await fetchDungeonRunEvents(runId, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }

    if (events && summary.id === currentRunId) syncEvents(events, false);
    if (summary.status === 'completed' || summary.status === 'failed') {
      pendingTerminalSummary = summary;
      if (events) maybeShowTerminalResult();
      else keepKnownRunVisible();
    } else {
      keepKnownRunVisible();
    }
    return knownRunPollDelay();
  }

  function preserveActiveRunDuringOutage(): boolean {
    if (
      !currentRunId ||
      displayedTerminalRunIds.has(currentRunId) ||
      (currentRunStatus !== 'joining' &&
        currentRunStatus !== 'running' &&
        entryPresentedRunId !== currentRunId &&
        activeTerminalSummary?.id !== currentRunId &&
        pendingTerminalSummary?.id !== currentRunId)
    ) {
      return false;
    }

    const now = Date.now();
    activeRunOutageStartedAt ??= now;
    if (now - activeRunOutageStartedAt >= ACTIVE_RUN_GRACE_MS) return false;

    const keepJoiningCountdown =
      currentRunStatus === 'joining' && countdownTimer !== null && countdownActiveRun?.id === currentRunId;
    if (!keepJoiningCountdown) {
      stopJoiningCountdown();
      hideStatus();
    }
    noticeVersion += 1;
    notice.hidden = true;
    notice.classList.remove('dov-notice--visible');
    activeJoinNotice = null;
    joinNoticeQueue = [];
    joinNoticeRunning = false;
    if (entryPresentedRunId === currentRunId || currentRunStatus === 'running') {
      root.classList.remove('dov-overlay--terminal');
      root.classList.add('dov-overlay--running');
      party.classList.add('dov-party--inside');
    }
    revealRealOverlay();
    return true;
  }

  function handleViewerInterruption(): number {
    if (hasKnownRunRecoveryContext()) {
      keepKnownRunVisible();
      return knownRunPollDelay();
    }
    if (preserveActiveRunDuringOutage()) return ACTIVE_RUN_RETRY_MS;
    activeRunOutageStartedAt = null;
    if (currentRunId !== null) resetRealRunState(null);
    concealRealOverlay();
    return REAL_POLL_IDLE_MS;
  }

  function pauseRunPresentationForVisibility(): void {
    const interruptedJoinNotice = activeJoinNotice;
    const interruptedEvent = activeQueuedEvent;
    const interruptedTerminal = activeTerminalSummary;

    if (interruptedTerminal && terminalPhaseStartedAt !== null) {
      const elapsed = Math.max(0, Date.now() - terminalPhaseStartedAt);
      if (terminalPhase === 'display') {
        terminalDisplayRemainingMs = Math.max(0, terminalDisplayRemainingMs - elapsed);
      } else if (terminalPhase === 'fade') {
        terminalFadeRemainingMs = Math.max(0, terminalFadeRemainingMs - elapsed);
      }
      terminalPhaseStartedAt = null;
    }

    clearRunTimers();

    if (interruptedJoinNotice) {
      joinNoticeQueue.unshift(interruptedJoinNotice);
    }
    activeJoinNotice = null;
    notice.hidden = true;
    notice.classList.remove('dov-notice--visible');

    if (interruptedEvent) {
      eventQueue.unshift(interruptedEvent);
      if (currentRunId) {
        forgetEventFeedItem(dungeonViewerEventFeedId(currentRunId, interruptedEvent.sequenceNumber));
      }
    }
    activeQueuedEvent = null;
    eventPanel.hidden = true;
    eventPanel.classList.remove('dov-event--visible');

    if (interruptedTerminal) {
      pendingTerminalSummary = interruptedTerminal;
      activeTerminalSummary = null;
      terminalPresentationRunning = false;
      hideResult();
      hideRewards();
      root.classList.remove('dov-overlay--terminal');
    }

    concealRealOverlay();
  }

  function resetRealRunState(nextRunId: string | null): void {
    clearRunTimers();
    stopCountdown();
    knownParticipantSlots = new Set<number>();
    joinNoticeQueue = [];
    activeJoinNotice = null;
    eventQueue = [];
    processedEventKeys.clear();
    terminalRecoveryRunIds.clear();
    activeQueuedEvent = null;
    highestEventSequence = 0;
    eventBaselineReady = false;
    pendingTerminalSummary = null;
    terminalPresentationRunning = false;
    activeTerminalSummary = null;
    terminalPresentationStartedAt = null;
    terminalPresentationRunId = null;
    terminalPhaseStartedAt = null;
    terminalDisplayRemainingMs = REAL_TERMINAL_DURATION_MS;
    terminalFadeRemainingMs = DUNGEON_TERMINAL_FADE_MS;
    terminalPhase = null;
    countdownZeroRunId = null;
    countdownZeroVisibleUntil = 0;
    deferredActiveRun = null;
    entryPresentedRunId = null;
    entryPresentationReadyAt = 0;
    entryEventFastPollUntil = 0;
    entryWaitTimerScheduled = false;
    activeRunOutageStartedAt = null;
    knownRunNotFoundStartedAt = null;
    currentRunId = nextRunId;
    currentRunStatus = null;
    resetScene();
    root.hidden = true;
  }

  function realPlayerFromParticipant(
    participant: DungeonViewerParticipant | DungeonViewerRunParticipant,
    terminal = false,
    restoreTerminalOutcome = false
  ): OverlayPlayer {
    const runParticipant = participant as DungeonViewerRunParticipant;
    const outcome = terminal
      ? runParticipant.survived === false
        ? 'dead'
        : runParticipant.survived === true
          ? 'survived'
          : undefined
      : undefined;
    return {
      name: participant.displayName,
      level: participant.level,
      outcome,
      isOpener: 'isOpener' in participant ? participant.isOpener : participant.slotNumber === 1,
      presentationKey: `${currentRunId ?? 'unknown-run'}:slot:${participant.slotNumber}`,
      restoreTerminalOutcome,
      ...(Object.prototype.hasOwnProperty.call(participant, 'visualLoadout')
        ? { visualLoadout: participant.visualLoadout }
        : {}),
    };
  }

  function resetMissingParticipantSlots(
    participants: Array<DungeonViewerParticipant | DungeonViewerRunParticipant>
  ): void {
    const occupiedSlots = new Set(participants.map((participant) => participant.slotNumber));
    slots.forEach((slot, index) => {
      if (!occupiedSlots.has(index + 1) && !slot.classList.contains('dov-slot--empty')) resetSlot(slot);
    });
  }

  function setRealParticipants(
    participants: Array<DungeonViewerParticipant | DungeonViewerRunParticipant>,
    terminal = false,
    motion?: PlayerMotion,
    restoreTerminalOutcome = false
  ): void {
    resetMissingParticipantSlots(participants);
    participants
      .slice()
      .sort((left, right) => left.slotNumber - right.slotNumber)
      .forEach((participant, index) => {
        setPlayer(
          participant.slotNumber - 1,
          realPlayerFromParticipant(participant, terminal, restoreTerminalOutcome),
          motion,
          runLater,
          motion === 'returning' ? index * PARTY_ENTRY_STAGGER_MS : 0
        );
      });
    updatePartyLayout();
    party.classList.remove('dov-party--inside');
  }

  function setJoiningParticipants(participants: DungeonViewerParticipant[], initialLoad: boolean): void {
    resetMissingParticipantSlots(participants);
    participants.forEach((participant) => {
      const arrivesNow = initialLoad || !knownParticipantSlots.has(participant.slotNumber);
      setPlayer(
        participant.slotNumber - 1,
        realPlayerFromParticipant(participant),
        arrivesNow ? 'arriving' : undefined,
        runLater
      );
    });
    updatePartyLayout();
    party.classList.remove('dov-party--inside');
  }

  function presentPartyEntryOnce(runId: string, participants: DungeonViewerParticipant[], startDelayMs = 0): boolean {
    if (entryPresentedRunId === runId) {
      root.classList.remove('dov-overlay--terminal');
      root.classList.add('dov-overlay--running');
      party.classList.add('dov-party--inside');
      revealRealOverlay();
      return false;
    }

    setRealParticipants(participants);
    stopCountdown();
    entryPresentedRunId = runId;
    entryPresentationReadyAt = Number.POSITIVE_INFINITY;
    entryEventFastPollUntil = 0;
    entryWaitTimerScheduled = false;
    revealRealOverlay();
    const beginEntry = () => {
      if (currentRunId !== runId) return;
      hideStatus();
      hideNotice(runLater);
      joinNoticeQueue = [];
      void sendPartyInside(runLater).then((startedAt) => {
        if (startedAt === null || currentRunId !== runId) return;
        entryPresentationReadyAt = startedAt + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_READY_DELAY_MS;
        entryEventFastPollUntil = startedAt + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_FAST_POLL_WINDOW_MS;
        processEventQueue();
      });
    };
    if (startDelayMs > 0) runLater(startDelayMs, beginEntry);
    else beginEntry();
    return true;
  }

  function countdownZeroHoldRemaining(runId: string): number {
    return countdownZeroRunId === runId ? Math.max(0, countdownZeroVisibleUntil - Date.now()) : 0;
  }

  function scheduleFullPartyEntry(activeRun: DungeonViewerActiveRun): void {
    stopJoiningCountdown();
    hideStatus();
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    revealRealOverlay();
    void nudgeLifecycleOnce(activeRun.id);

    if (entryPresentedRunId === activeRun.id || fullPartyEntryScheduledRunId === activeRun.id) {
      return;
    }

    fullPartyEntryScheduledRunId = activeRun.id;
    const entryDelay = slots.some((slot) => animationState(slot) === 'arriving')
      ? PLAYER_MOTION_DURATION_MS.arriving
      : REAL_FULL_PARTY_ENTRY_DELAY_MS;
    runLater(entryDelay, () => {
      if (currentRunId !== activeRun.id || currentRunStatus !== 'joining' || entryPresentedRunId === activeRun.id) {
        fullPartyEntryScheduledRunId = null;
        return;
      }
      fullPartyEntryScheduledRunId = null;
      presentPartyEntryOnce(activeRun.id, activeRun.participants);
    });
  }

  function waitForPartyEntry(): boolean {
    if (entryPresentedRunId !== currentRunId) return false;
    const remainingMs = entryPresentationReadyAt - Date.now();
    if (!Number.isFinite(remainingMs)) return true;
    if (remainingMs <= 0) return false;
    if (!entryWaitTimerScheduled) {
      entryWaitTimerScheduled = true;
      runLater(remainingMs, () => {
        entryWaitTimerScheduled = false;
        processEventQueue();
      });
    }
    return true;
  }

  function prepareRealEventScene(): void {
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    party.classList.add('dov-party--inside');
    startBattleAmbient();
    revealRealOverlay();
  }

  async function restoreRunningParticipantsInside(
    runId: string,
    participants: DungeonViewerParticipant[]
  ): Promise<void> {
    setRealParticipants(participants);
    const occupiedSlots = slots.filter((slot) => !slot.classList.contains('dov-slot--empty'));
    await Promise.all(occupiedSlots.map((slot) => ensurePrimaryActorAssets(slot)));
    if (disposed || currentRunId !== runId) return;
    occupiedSlots.forEach((slot) => setSlotAnimationState(slot, 'inside'));
    entryPresentedRunId = runId;
    entryPresentationReadyAt = 0;
    entryEventFastPollUntil = 0;
    entryWaitTimerScheduled = false;
    prepareRealEventScene();
  }

  function queueJoinNotices(participants: DungeonViewerParticipant[], initialLoad: boolean): void {
    const nextSlots = new Set(participants.map((participant) => participant.slotNumber));
    if (!initialLoad) {
      participants.forEach((participant) => {
        if (!knownParticipantSlots.has(participant.slotNumber)) {
          joinNoticeQueue.push(participant.displayName);
        }
      });
    }
    knownParticipantSlots = nextSlots;
    processJoinNoticeQueue();
  }

  function processJoinNoticeQueue(): void {
    if (
      document.hidden ||
      activeRunOutageStartedAt !== null ||
      joinNoticeRunning ||
      joinNoticeQueue.length === 0 ||
      currentRunStatus !== 'joining'
    )
      return;
    const playerName = joinNoticeQueue.shift();
    if (!playerName) return;
    joinNoticeRunning = true;
    activeJoinNotice = playerName;
    showNotice(playerName, runLater);
    runLater(2_000, () => {
      if (activeJoinNotice === playerName) activeJoinNotice = null;
    });
    runLater(2_200, () => {
      joinNoticeRunning = false;
      processJoinNoticeQueue();
    });
  }

  function updateServerClock(serverNow: string | null): void {
    const parsed = parseApiTimestamp(serverNow);
    if (parsed !== null) serverClockOffsetMs = parsed - Date.now();
  }

  function beginFastPolling(): void {
    nudgeFastPollUntil = Date.now() + NUDGE_FAST_POLL_WINDOW_MS;
    immediatePollRequested = true;
    if (!pollInFlight) scheduleRealPoll(0);
  }

  function nudgeHasViewerResult(runId: string): boolean {
    return (
      currentRunId !== runId ||
      highestEventSequence > 0 ||
      currentRunStatus === 'completed' ||
      currentRunStatus === 'failed' ||
      pendingTerminalSummary?.id === runId ||
      activeTerminalSummary?.id === runId ||
      displayedTerminalRunIds.has(runId)
    );
  }

  function scheduleNudgeRetry(runId: string): void {
    const attempts = nudgeAttempts.get(runId) ?? 0;
    const startedAt = nudgeStartedAt.get(runId) ?? Date.now();
    if (!canRetryDungeonLifecycleNudge(attempts, Date.now() - startedAt)) {
      debugNudge('nudge retry window exhausted', { attempts });
      return;
    }
    runLater(DUNGEON_NUDGE_RETRY_MS, () => {
      if (nudgeHasViewerResult(runId)) {
        nudgedRunIds.add(runId);
        return;
      }
      void nudgeLifecycleOnce(runId);
    });
  }

  async function nudgeLifecycleOnce(runId: string): Promise<void> {
    if (nudgedRunIds.has(runId) || abandonedNudgeRunIds.has(runId) || nudgeController || nudgeHasViewerResult(runId)) {
      if (nudgeHasViewerResult(runId)) nudgedRunIds.add(runId);
      return;
    }
    const attempt = (nudgeAttempts.get(runId) ?? 0) + 1;
    const startedAt = nudgeStartedAt.get(runId) ?? Date.now();
    nudgeStartedAt.set(runId, startedAt);
    const elapsedMs = Date.now() - startedAt;
    if (attempt > DUNGEON_NUDGE_MAX_ATTEMPTS || elapsedMs >= DUNGEON_NUDGE_RETRY_WINDOW_MS) return;
    nudgeAttempts.set(runId, attempt);
    const controller = new AbortController();
    nudgeController = controller;
    const requestTimeout = window.setTimeout(
      () => controller.abort(),
      Math.max(1, DUNGEON_NUDGE_RETRY_WINDOW_MS - elapsedMs)
    );
    runTimers.add(requestTimeout);
    debugNudge('nudge request', { attempt });
    try {
      const response = await advanceDungeonRunIfDue(runId, controller.signal);
      debugNudge('nudge response', {
        attempt,
        statusCode: response.httpStatus,
        result: response.result,
        eventsPersisted: response.eventsPersisted,
        statusAfter: response.statusAfter,
      });
      const action = dungeonLifecycleNudgeClientAction(response);
      if (action === 'complete') {
        nudgedRunIds.add(runId);
      } else if (action === 'retry') {
        scheduleNudgeRetry(runId);
      } else {
        abandonedNudgeRunIds.add(runId);
      }
      beginFastPolling();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      const requestError = error instanceof DungeonViewerRequestError ? error : null;
      const retryable = requestError === null || isRetryableDungeonLifecycleNudgeStatus(requestError.status);
      debugNudge('nudge request failed', {
        attempt,
        statusCode: requestError?.status ?? null,
        retryable,
      });
      if (retryable) {
        scheduleNudgeRetry(runId);
      } else {
        abandonedNudgeRunIds.add(runId);
      }
      beginFastPolling();
    } finally {
      window.clearTimeout(requestTimeout);
      runTimers.delete(requestTimeout);
      if (nudgeController === controller) nudgeController = null;
    }
  }

  function finishCountdown(activeRun: DungeonViewerActiveRun): void {
    setStatus(0, activeRun.joinedPlayers, 'تبدأ الرحلة خلال', activeRun.maxPlayers);
    countdownZeroRunId = activeRun.id;
    countdownZeroVisibleUntil = Date.now() + COUNTDOWN_ZERO_HOLD_MS;
    stopCountdown();
    debugNudge('countdown zero');
    void nudgeLifecycleOnce(activeRun.id);
    runLater(120, () => {
      if (currentRunId === activeRun.id && currentRunStatus === 'joining') {
        presentPartyEntryOnce(activeRun.id, activeRun.participants);
      }
    });
  }

  function updateCountdownDisplay(advanceOneSecond: boolean): void {
    const activeRun = countdownActiveRun;
    if (!activeRun || countdownDeadline === null || countdownRunId !== activeRun.id) return;

    const serverNow = Date.now() + serverClockOffsetMs;
    const targetSeconds = Math.max(0, Math.ceil((countdownDeadline - serverNow) / 1_000));

    if (countdownDisplayedSeconds === null) {
      countdownDisplayedSeconds = targetSeconds;
    } else if (advanceOneSecond && targetSeconds < countdownDisplayedSeconds) {
      countdownDisplayedSeconds -= 1;
    } else if (advanceOneSecond && targetSeconds > countdownDisplayedSeconds) {
      countdownDisplayedSeconds += 1;
    }

    setStatus(countdownDisplayedSeconds, activeRun.joinedPlayers, 'تبدأ الرحلة خلال', activeRun.maxPlayers);
    if (countdownDisplayedSeconds <= 0) finishCountdown(activeRun);
  }

  function scheduleCountdownTick(): void {
    if (
      countdownTimer !== null ||
      !countdownActiveRun ||
      countdownDeadline === null ||
      countdownDisplayedSeconds === null
    ) {
      return;
    }
    const serverNow = Date.now() + serverClockOffsetMs;
    const remainingMs = countdownDeadline - serverNow;
    const nextBoundaryMs = remainingMs - Math.max(0, countdownDisplayedSeconds - 1) * 1_000;
    const delayMs = Math.max(30, Math.min(1_000, Math.ceil(nextBoundaryMs) + 12));
    countdownTimer = window.setTimeout(() => {
      countdownTimer = null;
      if (disposed || !realMode || document.hidden || currentRunStatus !== 'joining') {
        stopCountdown();
        return;
      }
      updateCountdownDisplay(true);
      scheduleCountdownTick();
    }, delayMs);
  }

  function startCountdown(activeRun: DungeonViewerActiveRun): void {
    const parsedDeadline = parseApiTimestamp(activeRun.registrationClosesAt);
    const sameRun = countdownRunId === activeRun.id;
    countdownActiveRun = activeRun;
    countdownRunId = activeRun.id;

    if (parsedDeadline !== null) {
      countdownDeadline = parsedDeadline;
    } else if (!sameRun || countdownDeadline === null) {
      countdownDeadline = Date.now() + activeRun.secondsRemaining * 1_000;
    }

    if (!sameRun) {
      countdownDisplayedSeconds = null;
      updateCountdownDisplay(false);
    }
    if (entryPresentedRunId === activeRun.id) return;
    scheduleCountdownTick();
  }

  function eventPresentation(event: DungeonViewerEvent): DungeonEventFeedItem {
    return dungeonViewerEventToFeedItem(currentRunId ?? 'unknown-run', event);
  }

  function enqueueEvents(events: DungeonViewerEvent[]): void {
    events.forEach((event) => {
      const eventKey = `${currentRunId ?? 'unknown-run'}:${event.sequenceNumber}`;
      if (processedEventKeys.has(eventKey)) return;
      processedEventKeys.add(eventKey);
      highestEventSequence = Math.max(highestEventSequence, event.sequenceNumber);
      eventQueue.push(event);
    });
    eventQueue.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    processEventQueue();
  }

  function processEventQueue(): void {
    if (document.hidden || eventQueueRunning || waitForPartyEntry()) return;
    const event = eventQueue.shift();
    if (!event) {
      maybeShowTerminalResult();
      return;
    }
    eventQueueRunning = true;
    activeQueuedEvent = event;
    prepareRealEventScene();
    if (currentRunId && !debuggedFirstEventRunIds.has(currentRunId)) {
      debuggedFirstEventRunIds.add(currentRunId);
      debugNudge('first event displayed', { sequenceNumber: event.sequenceNumber });
    }
    hideEvent(runLater);
    appendEventFeedItem(eventPresentation(event), { animate: true, motion: true, schedule: runLater });
    runLater(REAL_EVENT_DURATION_MS, () => {
      if (activeQueuedEvent?.sequenceNumber === event.sequenceNumber) activeQueuedEvent = null;
      runLater(REAL_EVENT_GAP_MS, () => {
        eventQueueRunning = false;
        processEventQueue();
      });
    });
  }

  function syncEvents(
    events: DungeonViewerEvent[],
    baselineExistingEvents: boolean,
    hydrateRecoveredFeed = true
  ): void {
    if (!eventBaselineReady) {
      eventBaselineReady = true;
      if (baselineExistingEvents) {
        const latest = events.at(-1);
        highestEventSequence = latest?.sequenceNumber ?? 0;
        if (currentRunId) {
          events.forEach((event) => processedEventKeys.add(`${currentRunId}:${event.sequenceNumber}`));
        }
        if (currentRunId && hydrateRecoveredFeed)
          hydrateEventFeed(events.slice(-4).map((event) => dungeonViewerEventToFeedItem(currentRunId!, event)));
        return;
      }
    }
    enqueueEvents(events);
  }

  function isFailedTerminal(summary: DungeonViewerRunSummary): boolean {
    return summary.status === 'failed' || summary.result === 'failed';
  }

  function finishTerminalPresentation(summary: DungeonViewerRunSummary): void {
    if (activeTerminalSummary?.id !== summary.id) return;
    concealRealOverlay();
    activeTerminalSummary = null;
    terminalPresentationRunning = false;
    terminalPresentationStartedAt = null;
    terminalPresentationRunId = null;
    terminalPhaseStartedAt = null;
    terminalDisplayRemainingMs = REAL_TERMINAL_DURATION_MS;
    terminalFadeRemainingMs = DUNGEON_TERMINAL_FADE_MS;
    terminalPhase = null;
    countdownZeroRunId = null;
    countdownZeroVisibleUntil = 0;
    displayedTerminalRunIds.add(summary.id);
    clearEventFeed();
    hideResult();
    hideRewards();
    if (deferredActiveRun) scheduleRealPoll(0);
  }

  function startTerminalFade(summary: DungeonViewerRunSummary): void {
    cancelTerminalFade?.();
    terminalPhase = 'fade';
    terminalPhaseStartedAt = Date.now();
    cancelTerminalFade = beginDungeonTerminalFade(
      root,
      runLater,
      () => {
        cancelTerminalFade = null;
        finishTerminalPresentation(summary);
      },
      terminalFadeRemainingMs
    );
  }

  function scheduleTerminalPhase(summary: DungeonViewerRunSummary): void {
    if (terminalPhase === 'fade') {
      startTerminalFade(summary);
      return;
    }
    terminalPhase = 'display';
    terminalPhaseStartedAt = Date.now();
    runLater(terminalDisplayRemainingMs, () => {
      if (activeTerminalSummary?.id !== summary.id) return;
      terminalDisplayRemainingMs = 0;
      startTerminalFade(summary);
    });
  }

  function maybeShowTerminalResult(): void {
    const summary = pendingTerminalSummary;
    if (document.hidden || !summary || eventQueueRunning || eventQueue.length > 0 || terminalPresentationRunning)
      return;
    if (waitForPartyEntry()) return;
    const terminalVisibleAt = parseApiTimestamp(summary.completedAt);
    if (terminalVisibleAt !== null && terminalVisibleAt > Date.now() + serverClockOffsetMs) {
      showBattleStatus();
      return;
    }
    if (displayedTerminalRunIds.has(summary.id)) {
      pendingTerminalSummary = null;
      return;
    }

    pendingTerminalSummary = null;
    terminalPresentationRunning = true;
    activeTerminalSummary = summary;
    if (terminalPresentationRunId !== summary.id || terminalPresentationStartedAt === null) {
      terminalPresentationRunId = summary.id;
      terminalPresentationStartedAt = Date.now();
      terminalDisplayRemainingMs = REAL_TERMINAL_DURATION_MS;
      terminalFadeRemainingMs = DUNGEON_TERMINAL_FADE_MS;
      terminalPhase = 'display';
    }
    hideStatus();
    hideNotice(runLater);
    hideEvent(runLater);
    const failedTerminal = isFailedTerminal(summary);
    const recoveringTerminal = terminalRecoveryRunIds.delete(summary.id);
    const visibleParticipants = summary.participants.map((participant) =>
      !failedTerminal && participant.survived === true
        ? participant
        : {
            ...participant,
            status: 'dead',
            survived: false,
          }
    );
    setRealParticipants(visibleParticipants, true, recoveringTerminal ? undefined : 'returning', recoveringTerminal);
    const terminal = buildDungeonTerminalPresentation(summary);
    hideRewards();
    revealRealOverlay();
    hideEventFeedForTerminal(runLater, () => {
      if (activeTerminalSummary?.id !== summary.id || document.hidden) return;
      renderTerminalRewardRows(terminal.rows);
      showResult(!failedTerminal, terminal.description);
      scheduleTerminalPhase(summary);
    });
  }

  function hasUnfinishedRunPresentation(): boolean {
    return (
      activeQueuedEvent !== null ||
      eventQueue.length > 0 ||
      pendingTerminalSummary !== null ||
      activeTerminalSummary !== null ||
      terminalPresentationRunning
    );
  }

  async function syncDeferredPreviousRun(signal: AbortSignal): Promise<void> {
    const previousRunId = currentRunId;
    if (
      !previousRunId ||
      pendingTerminalSummary?.id === previousRunId ||
      activeTerminalSummary?.id === previousRunId ||
      displayedTerminalRunIds.has(previousRunId)
    ) {
      return;
    }
    const [summary, events] = await Promise.all([
      fetchDungeonRunSummary(previousRunId, signal),
      fetchDungeonRunEvents(previousRunId, signal),
    ]);
    if (currentRunId !== previousRunId || (summary.status !== 'completed' && summary.status !== 'failed')) {
      return;
    }
    if (currentRunId !== previousRunId) return;
    pendingTerminalSummary = summary;
    syncEvents(events, false);
    maybeShowTerminalResult();
  }

  function isStaleTerminal(summary: DungeonViewerRunSummary): boolean {
    const completedAt = parseApiTimestamp(summary.completedAt);
    return completedAt !== null && completedAt < pageLoadedAt - REAL_TERMINAL_STALE_MS;
  }

  async function syncRunningRun(
    activeRun: DungeonViewerActiveRun,
    signal: AbortSignal,
    openedDuringRunning: boolean,
    transitionedFromJoining: boolean
  ): Promise<void> {
    const zeroHoldMs = transitionedFromJoining ? countdownZeroHoldRemaining(activeRun.id) : 0;
    stopCountdown();
    if (zeroHoldMs <= 0) hideStatus();
    hideNotice(runLater);
    joinNoticeQueue = [];

    if (openedDuringRunning) {
      await restoreRunningParticipantsInside(activeRun.id, activeRun.participants);
    } else if (transitionedFromJoining) {
      presentPartyEntryOnce(activeRun.id, activeRun.participants, zeroHoldMs);
    } else {
      revealRealOverlay();
    }

    const [summary, events] = await Promise.all([
      fetchDungeonRunSummary(activeRun.id, signal),
      fetchDungeonRunEvents(activeRun.id, signal),
    ]);
    updateServerClock(summary.serverNow);
    if (summary.id !== currentRunId) return;
    syncEvents(events, openedDuringRunning);
  }

  async function syncTerminalRun(
    activeRun: DungeonViewerActiveRun,
    signal: AbortSignal,
    openedDuringTerminal: boolean
  ): Promise<void> {
    stopCountdown();
    if (countdownZeroHoldRemaining(activeRun.id) <= 0) hideStatus();
    joinNoticeQueue = [];

    if (displayedTerminalRunIds.has(activeRun.id) || terminalPresentationRunning) return;
    const [summary, events] = await Promise.all([
      fetchDungeonRunSummary(activeRun.id, signal),
      fetchDungeonRunEvents(activeRun.id, signal),
    ]);
    updateServerClock(summary.serverNow);
    if (summary.id !== currentRunId || (summary.status !== 'completed' && summary.status !== 'failed')) return;

    if (openedDuringTerminal && isStaleTerminal(summary)) {
      displayedTerminalRunIds.add(summary.id);
      concealRealOverlay();
      return;
    }

    if (summary.id !== currentRunId) return;
    pendingTerminalSummary = summary;
    if (openedDuringTerminal) terminalRecoveryRunIds.add(summary.id);
    syncEvents(events, openedDuringTerminal, false);
    maybeShowTerminalResult();
  }

  async function handleActiveRun(activeRun: DungeonViewerActiveRun, signal: AbortSignal): Promise<number> {
    updateServerClock(activeRun.serverNow);
    const isNewRun = activeRun.id !== currentRunId;
    if (isNewRun && currentRunId && hasUnfinishedRunPresentation()) {
      deferredActiveRun = activeRun;
      await syncDeferredPreviousRun(signal);
      return REAL_POLL_ACTIVE_MS;
    }
    if (isNewRun) resetRealRunState(activeRun.id);
    const previousStatus = currentRunStatus;

    if (activeRun.status === 'joining') {
      currentRunStatus = 'joining';
      if (entryPresentedRunId === activeRun.id) {
        knownParticipantSlots = new Set(activeRun.participants.map((participant) => participant.slotNumber));
        keepKnownRunVisible();
        if (
          activeRun.secondsRemaining <= 0 ||
          activeRun.joinedPlayers >= activeRun.maxPlayers ||
          activeRun.remainingSlots === 0
        ) {
          void nudgeLifecycleOnce(activeRun.id);
        }
        return (await recoverKnownRun(signal)) ?? knownRunPollDelay();
      }
      root.classList.remove('dov-overlay--running', 'dov-overlay--terminal');
      setJoiningParticipants(activeRun.participants, isNewRun);
      queueJoinNotices(activeRun.participants, isNewRun);
      if (activeRun.joinedPlayers >= activeRun.maxPlayers || activeRun.remainingSlots === 0) {
        scheduleFullPartyEntry(activeRun);
        return REAL_POLL_ACTIVE_MS;
      }
      startCountdown(activeRun);
      revealRealOverlay(isNewRun);
      return REAL_POLL_ACTIVE_MS;
    }

    if (activeRun.status === 'running') {
      const openedDuringRunning = isNewRun;
      const transitionedFromJoining = previousStatus === 'joining';
      currentRunStatus = 'running';
      await syncRunningRun(activeRun, signal, openedDuringRunning, transitionedFromJoining);
      return knownRunPollDelay();
    }

    const transitionedFromJoining = previousStatus === 'joining';
    currentRunStatus = activeRun.status;
    if (transitionedFromJoining) {
      presentPartyEntryOnce(activeRun.id, activeRun.participants, countdownZeroHoldRemaining(activeRun.id));
    }
    await syncTerminalRun(activeRun, signal, isNewRun);
    return knownRunPollDelay();
  }

  function scheduleRealPoll(delayMs: number): void {
    if (disposed || !realMode || document.hidden) return;
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void pollRealMode();
    }, delayMs);
  }

  async function pollRealMode(): Promise<void> {
    if (disposed || !realMode || document.hidden) return;
    if (pollInFlight) {
      scheduleRealPoll(100);
      return;
    }
    pollInFlight = true;
    const controller = new AbortController();
    requestController = controller;
    let nextDelay = REAL_POLL_IDLE_MS;

    try {
      const activeRun = await fetchActiveDungeonRun(controller.signal);
      if (!activeRun) {
        nextDelay = (await recoverKnownRun(controller.signal)) ?? handleViewerInterruption();
      } else {
        knownRunNotFoundStartedAt = null;
        nextDelay = await handleActiveRun(activeRun, controller.signal);
        activeRunOutageStartedAt = null;
        processJoinNoticeQueue();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        nextDelay = (await recoverKnownRun(controller.signal)) ?? handleViewerInterruption();
      }
    } finally {
      if (requestController === controller) requestController = null;
      pollInFlight = false;
      if (!controller.signal.aborted) {
        if (immediatePollRequested) {
          immediatePollRequested = false;
          scheduleRealPoll(0);
        } else if (Date.now() < nudgeFastPollUntil) {
          scheduleRealPoll(Math.min(nextDelay, NUDGE_FAST_POLL_MS));
        } else {
          scheduleRealPoll(nextDelay);
        }
      }
    }
  }

  function handleVisibilityChange(): void {
    if (!realMode || disposed) return;
    if (document.hidden) {
      stopPolling();
      stopCountdown();
      pauseRunPresentationForVisibility();
      return;
    }
    scheduleRealPoll(0);
  }

  const hasDemoParameter = searchParams.has('demo');
  const demoMode = requestedDemo && DEMO_MODES.has(requestedDemo as DemoMode) ? (requestedDemo as DemoMode) : null;

  if (demoMode) {
    resetScene();
    scene.dataset.demo = demoMode;
    root.hidden = false;
    later(20, () => root.classList.add('dov-overlay--visible'));

    const runners: Record<DemoMode, () => void> = {
      joining: runJoiningDemo,
      running: runRunningDemo,
      completed: runCompletedDemo,
      failed: runFailedDemo,
      sequence: runSequenceDemo,
      'animation-red-gate': runAnimationRedGateDemo,
      'animation-party-gate': runAnimationPartyGateDemo,
      'real-mode-regression': runRealModeRegressionDemo,
      'joining-stability': runJoiningStabilityDemo,
      'meta-anchor-regression': runMetaAnchorRegressionDemo,
      'event-feed-regression': runEventFeedRegressionDemo,
      'reward-summary-regression': runRewardSummaryRegressionDemo,
      'presentation-stability-regression': runPresentationStabilityRegressionDemo,
      'equipment-integration': runEquipmentIntegrationDemo,
    };
    runners[demoMode]();
  } else if (!hasDemoParameter) {
    realMode = true;
    resetRealRunState(null);
    root.hidden = true;
    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduleRealPoll(0);
  } else {
    resetScene();
    root.hidden = true;
  }
}
