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
import { setPlayerAnimationState, type DungeonPlayerAnimationState } from './dungeon-overlay-animation-state';
import {
  CHARACTER_ANIMATION_CONFIG,
  DUNGEON_CHARACTER_STYLES,
  type DungeonCharacterStyle,
} from './dungeon-overlay-character-config';

type DemoMode =
  | 'joining'
  | 'running'
  | 'completed'
  | 'failed'
  | 'sequence'
  | 'animation-red-gate'
  | 'animation-party-gate';
type PlayerOutcome = 'survived' | 'dead';
type PlayerMotion = 'arriving' | 'returning';
type EventTone = 'normal' | 'mystery' | 'danger';
type EventIconKind = 'entrance' | 'trap' | 'encounter' | 'treasure' | 'boss';

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
const REAL_TERMINAL_FADE_MS = 400;
const REAL_TERMINAL_STALE_MS = 15_000;
const DEMO_EVENT_GAP_MS = 350;
const ENTRY_EVENT_READY_DELAY_MS = 600;
const PARTY_ENTRY_TRAVEL_MS = 740;
const PARTY_ENTRY_STAGGER_MS = 60;
const PARTY_ENTRY_DURATION_MS = 1_040;
const ENTRY_FX_START_DELAY_MS = PARTY_ENTRY_DURATION_MS;
const ENTRY_FX_DURATION_MS = 1_700;
const PLAYER_HIT_DURATION_MS = 240;
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
}

interface DemoPlayer extends OverlayPlayer {
  level: number;
}

interface DemoEvent {
  icon: EventIconKind;
  text: string;
  tone: EventTone;
  playerSlots?: number[];
}

interface DemoReward {
  player: string;
  xp: number;
  item?: string;
}

interface DungeonOverlayWindow extends Window {
  __tnxDungeonOverlayCleanup?: () => void;
}

const DEMO_MODES = new Set<DemoMode>([
  'joining',
  'running',
  'completed',
  'failed',
  'sequence',
  'animation-red-gate',
  'animation-party-gate',
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

const clientWindow = window as DungeonOverlayWindow;
clientWindow.__tnxDungeonOverlayCleanup?.();

const root = document.getElementById('dungeonOverlay');
const scene = document.getElementById('dungeonOverlayScene');
const notice = document.getElementById('dovJoinNotice');
const noticeText = document.getElementById('dovJoinNoticeText');
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
  party &&
  entryFx &&
  battleAmbient &&
  slots.length === 6;

if (elementsReady) {
  slots.forEach((slot, index) => configureCharacterActor(slot, index));
  const timers = new Set<number>();
  const runTimers = new Set<number>();
  const displayedTerminalRunIds = new Set<string>();
  const searchParams = new URLSearchParams(window.location.search);
  const requestedDemoPlayerCount = Number(searchParams.get('players'));
  const demoPlayerCount = Number.isSafeInteger(requestedDemoPlayerCount)
    ? Math.min(6, Math.max(1, requestedDemoPlayerCount))
    : 4;
  const dungeonDebug = searchParams.get('dungeonDebug') === '1';
  const pageLoadedAt = Date.now();
  let disposed = false;
  let noticeVersion = 0;
  let eventVersion = 0;
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
  let terminalFadeRemainingMs = REAL_TERMINAL_FADE_MS;
  let terminalPhase: 'display' | 'fade' | null = null;
  let deferredActiveRun: DungeonViewerActiveRun | null = null;
  let fullPartyEntryScheduledRunId: string | null = null;
  const nudgeAttempts = new Map<string, number>();
  const nudgeStartedAt = new Map<string, number>();
  const nudgedRunIds = new Set<string>();
  const abandonedNudgeRunIds = new Set<string>();
  const debuggedFirstEventRunIds = new Set<string>();
  let nudgeFastPollUntil = 0;

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
    window.removeEventListener('pagehide', cleanup);
    window.removeEventListener('beforeunload', cleanup);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    document.removeEventListener('astro:before-swap', cleanup);
    if (clientWindow.__tnxDungeonOverlayCleanup === cleanup) {
      delete clientWindow.__tnxDungeonOverlayCleanup;
    }
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

  function showEvent(event: DemoEvent): void {
    eventVersion += 1;
    eventIcon.replaceChildren();
    eventIcon.dataset.icon = event.icon;
    eventText.textContent = event.text;
    eventPanel.dataset.tone = event.tone;
    eventPanel.hidden = false;
    eventPanel.classList.remove('dov-event--visible');
    void eventPanel.offsetWidth;
    eventPanel.classList.add('dov-event--visible');
    triggerEventMotion(event);
  }

  function triggerPlayerHit(slotNumber: number, schedule: typeof later): boolean {
    const slot = slots[slotNumber - 1];
    if (!slot || slot.classList.contains('dov-slot--empty')) return false;
    const currentState = animationState(slot);
    if (currentState !== 'inside') return false;
    startTransientPlayerState(slot, 'hit', 'inside', PLAYER_HIT_DURATION_MS, schedule);
    return true;
  }

  function triggerEventMotion(event: DemoEvent): void {
    const schedule = realMode ? runLater : later;
    const playerWasHit = (event.playerSlots ?? []).some((slotNumber) => triggerPlayerHit(slotNumber, schedule));
    if (event.tone === 'danger') {
      pulseBattleAmbient(schedule);
      if (!playerWasHit || party.classList.contains('dov-party--inside')) showEntryFx(schedule);
    } else if (event.tone === 'mystery') {
      pulseBattleAmbient(schedule);
    }
  }

  function showBattleStatus(): void {
    if (activeQueuedEvent || eventQueueRunning) return;
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
    if (state !== 'arriving' && state !== 'returning' && state !== 'hit' && state !== 'dead') {
      delete actor.dataset.animationEndsAt;
    }
    return setPlayerAnimationState(actor, state, restart);
  }

  function startTransientPlayerState(
    slot: HTMLElement,
    state: Extract<DungeonPlayerAnimationState, 'arriving' | 'returning' | 'hit' | 'dead'>,
    nextState: DungeonPlayerAnimationState,
    durationMs: number,
    schedule: typeof later
  ): void {
    const actor = playerActor(slot);
    if (!actor) return;
    setPlayerAnimationState(actor, state, true);
    actor.dataset.animationEndsAt = String(Date.now() + durationMs);
    schedule(durationMs, () => {
      if (actor.dataset.animationState !== state) return;
      delete actor.dataset.animationEndsAt;
      setPlayerAnimationState(actor, nextState);
    });
  }

  function settleElapsedPlayerState(slot: HTMLElement, nextState: DungeonPlayerAnimationState): boolean {
    const actor = playerActor(slot);
    const endsAt = Number(actor?.dataset.animationEndsAt);
    if (!actor || !Number.isFinite(endsAt) || endsAt > Date.now()) return false;
    delete actor.dataset.animationEndsAt;
    setPlayerAnimationState(actor, nextState);
    return true;
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
    scene.classList.remove('dov-scene--result');
  }

  function showResult(completed: boolean, description: string): void {
    stopBattleAmbient();
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
      xp.textContent = `+${reward.xp} XP`;
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
      setPlayerAnimationState(actor, 'inside');
    }
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
    slot.className = 'dov-slot';
    if (player.isOpener ?? slotIndex === 0) slot.classList.add('dov-slot--opener');
    if (player.outcome) slot.classList.add(`dov-slot--${player.outcome}`);
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

    const currentState = animationState(slot);
    if (player.outcome === 'dead') {
      if (currentState === 'dead') settleElapsedPlayerState(slot, 'ghost');
      else if (currentState !== 'ghost') {
        startTransientPlayerState(slot, 'dead', 'ghost', playerDeathDuration(slot), schedule);
      }
    } else if (motion) {
      const actor = playerActor(slot);
      if (motion === 'returning') {
        actor?.style.setProperty('--dov-return-stagger', `${motionDelayMs}ms`);
      }
      startTransientPlayerState(slot, motion, 'idle', PLAYER_MOTION_DURATION_MS[motion] + motionDelayMs, schedule);
    } else if (currentState === 'arriving' || currentState === 'returning') {
      settleElapsedPlayerState(slot, 'idle');
    } else if (currentState !== 'hit') {
      setSlotAnimationState(slot, 'idle');
    }
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

  function sendPartyInside(schedule: typeof later = later): void {
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    stopBattleAmbient();
    const activeSlots = slots.filter((slot) => !slot.classList.contains('dov-slot--empty'));
    activeSlots.forEach((slot, index) => {
      const actor = playerActor(slot);
      actor?.style.setProperty('--dov-entry-stagger', `${index * PARTY_ENTRY_STAGGER_MS}ms`);
      actor?.style.setProperty('--dov-entry-duration', `${PARTY_ENTRY_TRAVEL_MS}ms`);
      setSlotAnimationState(slot, 'entering', true);
    });
    party.classList.add('dov-party--inside');
    schedule(ENTRY_FX_START_DELAY_MS, () => {
      activeSlots.forEach((slot) => {
        if (animationState(slot) === 'entering') setSlotAnimationState(slot, 'inside');
      });
      startBattleAmbient();
      showEntryFx(schedule);
      showBattleStatus();
    });
  }

  function resetScene(): void {
    root.classList.remove(
      'dov-overlay--visible',
      'dov-overlay--fading',
      'dov-overlay--running',
      'dov-overlay--terminal',
      'dov-overlay--instant'
    );
    notice.hidden = true;
    notice.classList.remove('dov-notice--visible');
    eventPanel.hidden = true;
    eventPanel.classList.remove('dov-event--visible');
    hideEntryFx();
    stopBattleAmbient();
    hideStatus();
    hideResult();
    hideRewards();
    setPlayers([]);
  }

  function fadeOut(delayMs: number): void {
    later(delayMs, () => {
      root.classList.add('dov-overlay--fading');
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
    showResult(true, 'عاد الناجون ومعهم غنائم الرحلة');
    showRewards(COMPLETED_REWARDS);
    fadeOut(REAL_TERMINAL_DURATION_MS + REAL_TERMINAL_FADE_MS);
  }

  function runFailedDemo(): void {
    const defeatedPlayers = PLAYERS.slice(0, demoPlayerCount).map((player) => ({
      ...player,
      outcome: 'dead' as const,
    }));
    setPlayers(defeatedPlayers, 'returning');
    showResult(false, 'فشلت الرحلة ولم ينجُ أحد من أعماق الدنجن');
    hideRewards();
    fadeOut(REAL_TERMINAL_DURATION_MS + REAL_TERMINAL_FADE_MS);
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
      showResult(false, 'فشلت الرحلة ولم ينجُ أحد من أعماق الدنجن');
      hideRewards();
    });
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
      showResult(true, 'عاد الناجون ومعهم غنائم الرحلة');
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
    root.hidden = false;
    root.classList.remove('dov-overlay--fading');
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
    root.classList.remove('dov-overlay--visible', 'dov-overlay--fading');
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
    terminalFadeRemainingMs = REAL_TERMINAL_FADE_MS;
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
    terminal = false
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
    motion?: PlayerMotion
  ): void {
    resetMissingParticipantSlots(participants);
    participants
      .slice()
      .sort((left, right) => left.slotNumber - right.slotNumber)
      .forEach((participant, index) => {
        setPlayer(
          participant.slotNumber - 1,
          realPlayerFromParticipant(participant, terminal),
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
      slots.forEach((slot) => {
        if (!slot.classList.contains('dov-slot--empty')) setSlotAnimationState(slot, 'inside');
      });
      startBattleAmbient();
      revealRealOverlay();
      return false;
    }

    setRealParticipants(participants);
    stopCountdown();
    entryPresentedRunId = runId;
    entryPresentationReadyAt = Date.now() + startDelayMs + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_READY_DELAY_MS;
    entryEventFastPollUntil = Date.now() + startDelayMs + PARTY_ENTRY_DURATION_MS + ENTRY_EVENT_FAST_POLL_WINDOW_MS;
    entryWaitTimerScheduled = false;
    revealRealOverlay();
    const beginEntry = () => {
      if (currentRunId !== runId) return;
      hideStatus();
      hideNotice(runLater);
      joinNoticeQueue = [];
      sendPartyInside(runLater);
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
    slots.forEach((slot) => {
      if (!slot.classList.contains('dov-slot--empty')) setSlotAnimationState(slot, 'inside');
    });
    startBattleAmbient();
    revealRealOverlay();
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

  function eventPresentation(event: DungeonViewerEvent): DemoEvent {
    const icon: EventIconKind =
      event.stage === 'result' ? (event.outcome === 'failed' ? 'boss' : 'treasure') : event.stage;
    const tone: EventTone =
      event.severity === 'danger' || event.stage === 'boss'
        ? 'danger'
        : event.stage === 'treasure' || event.severity === 'success'
          ? 'mystery'
          : 'normal';
    const text = event.message === event.title ? event.title : `${event.title}: ${event.message}`;
    return {
      icon,
      text,
      tone,
      playerSlots: event.players.map((player) => player.slotNumber),
    };
  }

  function enqueueEvents(events: DungeonViewerEvent[]): void {
    events.forEach((event) => {
      if (event.sequenceNumber <= highestEventSequence) return;
      highestEventSequence = event.sequenceNumber;
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
    showEvent(eventPresentation(event));
    runLater(REAL_EVENT_DURATION_MS, () => {
      if (activeQueuedEvent?.sequenceNumber === event.sequenceNumber) activeQueuedEvent = null;
      hideEvent(runLater);
      runLater(REAL_EVENT_GAP_MS, () => {
        eventQueueRunning = false;
        processEventQueue();
      });
    });
  }

  function syncEvents(events: DungeonViewerEvent[], baselineExistingEvents: boolean): void {
    if (!eventBaselineReady) {
      eventBaselineReady = true;
      if (baselineExistingEvents) {
        const latest = events.at(-1);
        highestEventSequence = latest?.sequenceNumber ?? 0;
        if (latest) {
          eventQueue.push(latest);
          processEventQueue();
        }
        return;
      }
    }
    enqueueEvents(events);
  }

  function createRewardCard(
    target: HTMLElement,
    displayName: string,
    xpValue: number,
    materials: Array<{ itemName: string; quantity: number }>
  ): void {
    const card = document.createElement('article');
    card.className = 'dov-reward';

    const name = document.createElement('strong');
    name.textContent = displayName;
    const xp = document.createElement('span');
    xp.textContent = `+${xpValue} XP`;
    card.append(name, xp);

    materials.forEach((materialReward) => {
      const material = document.createElement('span');
      material.textContent = `${materialReward.itemName} ×${materialReward.quantity}`;
      card.append(material);
    });
    target.replaceChildren(card);
  }

  function showRealRewards(summary: DungeonViewerRunSummary): string[] {
    hideRewards();
    const participantsByName = new Map<string, DungeonViewerRunParticipant[]>();
    summary.participants.forEach((participant) => {
      const matches = participantsByName.get(participant.displayName) ?? [];
      matches.push(participant);
      participantsByName.set(participant.displayName, matches);
    });

    const generalRewards: string[] = [];
    summary.rewards.forEach((reward) => {
      const matchingParticipants = participantsByName.get(reward.displayName) ?? [];
      if (matchingParticipants.length === 1) {
        const matchingSlot = slots[matchingParticipants[0].slotNumber - 1];
        const target = matchingSlot?.querySelector<HTMLElement>('.dov-slot__reward');
        if (target && !matchingSlot.classList.contains('dov-slot--empty')) {
          createRewardCard(target, reward.displayName, reward.xp, reward.materials);
          return;
        }
      }
      const materialText = reward.materials
        .map((materialReward) => `${materialReward.itemName} ×${materialReward.quantity}`)
        .join('، ');
      generalRewards.push(`${reward.displayName}: +${reward.xp} XP${materialText ? `، ${materialText}` : ''}`);
    });
    return generalRewards;
  }

  function isFailedTerminal(summary: DungeonViewerRunSummary): boolean {
    return summary.status === 'failed' || summary.result === 'failed';
  }

  function terminalDescription(summary: DungeonViewerRunSummary, generalRewards: string[]): string {
    const survivors = summary.participants.filter((participant) => participant.survived === true).length;
    const base = isFailedTerminal(summary)
      ? 'فشلت الرحلة ولم ينجُ أحد من أعماق الدنجن'
      : `عاد ${survivors} من المغامرين ومعهم غنائم الرحلة`;
    return generalRewards.length > 0 ? `${base} • ${generalRewards.join(' • ')}` : base;
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
    terminalFadeRemainingMs = REAL_TERMINAL_FADE_MS;
    terminalPhase = null;
    countdownZeroRunId = null;
    countdownZeroVisibleUntil = 0;
    displayedTerminalRunIds.add(summary.id);
    if (deferredActiveRun) scheduleRealPoll(0);
  }

  function scheduleTerminalPhase(summary: DungeonViewerRunSummary): void {
    if (terminalPhase === 'fade') {
      root.classList.add('dov-overlay--fading');
      terminalPhaseStartedAt = Date.now();
      runLater(terminalFadeRemainingMs, () => finishTerminalPresentation(summary));
      return;
    }
    terminalPhase = 'display';
    terminalPhaseStartedAt = Date.now();
    runLater(terminalDisplayRemainingMs, () => {
      if (activeTerminalSummary?.id !== summary.id) return;
      terminalDisplayRemainingMs = 0;
      terminalPhase = 'fade';
      terminalPhaseStartedAt = Date.now();
      root.classList.add('dov-overlay--fading');
      runLater(terminalFadeRemainingMs, () => finishTerminalPresentation(summary));
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
      terminalFadeRemainingMs = REAL_TERMINAL_FADE_MS;
      terminalPhase = 'display';
    }
    hideStatus();
    hideNotice(runLater);
    hideEvent(runLater);
    const failedTerminal = isFailedTerminal(summary);
    const visibleParticipants = summary.participants.map((participant) =>
      !failedTerminal && participant.survived === true
        ? participant
        : {
            ...participant,
            status: 'dead',
            survived: false,
          }
    );
    setRealParticipants(visibleParticipants, true, 'returning');
    const generalRewards = showRealRewards(summary);
    revealRealOverlay();
    showResult(!failedTerminal, terminalDescription(summary, generalRewards));
    scheduleTerminalPhase(summary);
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
      presentPartyEntryOnce(activeRun.id, activeRun.participants);
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
    syncEvents(events, false);
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
  const requestedDemo = searchParams.get('demo');
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
