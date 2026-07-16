import {
  fetchActiveDungeonRun,
  fetchDungeonRunEvents,
  fetchDungeonRunSummary,
  parseApiTimestamp,
  type DungeonViewerActiveRun,
  type DungeonViewerEvent,
  type DungeonViewerParticipant,
  type DungeonViewerRunParticipant,
  type DungeonViewerRunSummary,
} from './dungeon-overlay-viewer';

type DemoMode = 'joining' | 'running' | 'completed' | 'failed' | 'sequence';
type PlayerOutcome = 'survived' | 'dead';
type PlayerMotion = 'arriving' | 'returning';
type EventTone = 'normal' | 'mystery' | 'danger';
type EventIconKind = 'entrance' | 'trap' | 'encounter' | 'treasure' | 'boss';

const PLAYER_MOTION_DURATION_MS: Record<PlayerMotion, number> = {
  arriving: 880,
  returning: 880,
};

const REAL_POLL_ACTIVE_MS = 3_000;
const REAL_POLL_IDLE_MS = 10_000;
const REAL_POLL_TERMINAL_MS = 15_000;
const ACTIVE_RUN_RETRY_MS = 2_500;
const ACTIVE_RUN_GRACE_MS = 20_000;
const REAL_EVENT_DURATION_MS = 3_000;
const REAL_TERMINAL_DURATION_MS = 11_000;
const REAL_TERMINAL_STALE_MS = 15_000;

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
}

interface DemoReward {
  player: string;
  xp: number;
  item?: string;
}

interface DungeonOverlayWindow extends Window {
  __tnxDungeonOverlayCleanup?: () => void;
}

const DEMO_MODES = new Set<DemoMode>(['joining', 'running', 'completed', 'failed', 'sequence']);

const PLAYERS: DemoPlayer[] = [
  { name: 'تنكس', level: 1 },
  { name: 'tnx66', level: 3 },
  { name: 'خالد', level: 2 },
  { name: 'سعد', level: 4 },
];

const RUN_EVENTS: DemoEvent[] = [
  { icon: 'entrance', text: 'دخل الفريق إلى أعماق الدنجن.', tone: 'normal' },
  { icon: 'trap', text: 'عبر الفريق ممر الفخاخ بسلام.', tone: 'normal' },
  { icon: 'encounter', text: 'واجه تنكس وحش الظلال.', tone: 'danger' },
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
  slots.length === 6;

if (elementsReady) {
  const timers = new Set<number>();
  const runTimers = new Set<number>();
  const displayedTerminalRunIds = new Set<string>();
  const pageLoadedAt = Date.now();
  let disposed = false;
  let noticeVersion = 0;
  let eventVersion = 0;
  let realMode = false;
  let pollTimer: number | null = null;
  let countdownTimer: number | null = null;
  let requestController: AbortController | null = null;
  let pollInFlight = false;
  let currentRunId: string | null = null;
  let currentRunStatus: DungeonViewerActiveRun['status'] | null = null;
  let countdownDeadline: number | null = null;
  let entryPresentedRunId: string | null = null;
  let entryPresentationReadyAt = 0;
  let entryWaitTimerScheduled = false;
  let activeRunOutageStartedAt: number | null = null;
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
  }

  function stopCountdown(): void {
    if (countdownTimer !== null) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownDeadline = null;
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    requestController?.abort();
    requestController = null;
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
  }

  function setPlayer(
    slotIndex: number,
    player: OverlayPlayer,
    motion?: PlayerMotion,
    schedule: typeof later = later
  ): void {
    const slot = slots[slotIndex];
    if (!slot) return;
    slot.className = 'dov-slot';
    if (player.isOpener ?? slotIndex === 0) slot.classList.add('dov-slot--opener');
    if (motion) {
      const motionClass = `dov-slot--${motion}`;
      slot.classList.add(motionClass);
      schedule(PLAYER_MOTION_DURATION_MS[motion], () => slot.classList.remove(motionClass));
    }
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
    updatePartyLayout();
  }

  function setPlayers(players: OverlayPlayer[], motion?: PlayerMotion, schedule: typeof later = later): void {
    slots.forEach(resetSlot);
    players.slice(0, slots.length).forEach((player, index) => setPlayer(index, player, motion, schedule));
    updatePartyLayout();
    party.classList.remove('dov-party--inside');
  }

  function sendPartyInside(): void {
    root.classList.remove('dov-overlay--terminal');
    root.classList.add('dov-overlay--running');
    party.classList.add('dov-party--inside');
  }

  function resetScene(): void {
    root.classList.remove(
      'dov-overlay--visible',
      'dov-overlay--fading',
      'dov-overlay--running',
      'dov-overlay--terminal'
    );
    notice.hidden = true;
    notice.classList.remove('dov-notice--visible');
    eventPanel.hidden = true;
    eventPanel.classList.remove('dov-event--visible');
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
    setPlayers(PLAYERS);
    setStatus(43, PLAYERS.length);
    showNotice('تنكس');
  }

  function runRunningDemo(): void {
    setPlayers(PLAYERS);
    later(120, sendPartyInside);
    RUN_EVENTS.forEach((event, index) => {
      later(index * 3_100, () => showEvent(event));
    });
  }

  function runCompletedDemo(): void {
    const survivors = PLAYERS.slice(0, 2).map((player) => ({ ...player, outcome: 'survived' as const }));
    setPlayers(survivors, 'returning');
    showResult(true, 'عاد الناجون ومعهم غنائم الرحلة');
    showRewards(COMPLETED_REWARDS);
    fadeOut(14_000);
  }

  function runFailedDemo(): void {
    const returnedPlayers: DemoPlayer[] = [
      { ...PLAYERS[0], outcome: 'survived' },
      { ...PLAYERS[2], outcome: 'survived' },
      { ...PLAYERS[1], outcome: 'dead' },
    ];
    setPlayers(returnedPlayers, 'returning');
    showResult(false, 'نجا لاعبان من أصل أربعة');
    showRewards([
      { player: 'تنكس', xp: 35 },
      { player: 'خالد', xp: 35 },
    ]);
    fadeOut(14_000);
  }

  function runSequenceDemo(): void {
    const joinMoments = [500, 2_800, 5_100, 7_400];
    joinMoments.forEach((moment, index) => {
      later(moment, () => {
        setPlayer(index, PLAYERS[index], 'arriving');
        showNotice(PLAYERS[index].name);
      });
    });

    later(9_200, () => setStatus(10, PLAYERS.length));
    for (let elapsed = 1; elapsed <= 10; elapsed += 1) {
      later(9_200 + elapsed * 900, () => {
        countdown.textContent = String(10 - elapsed);
        if (elapsed === 10) {
          hideNotice();
          hideStatus();
          sendPartyInside();
        }
      });
    }

    RUN_EVENTS.forEach((event, index) => {
      later(20_200 + index * 3_200, () => showEvent(event));
    });

    later(36_800, () => {
      hideEvent();
      showResult(true, 'عاد الناجون ومعهم غنائم الرحلة');
    });

    later(38_200, () => {
      const survivors = PLAYERS.slice(0, 2).map((player) => ({ ...player, outcome: 'survived' as const }));
      setPlayers(survivors, 'returning');
    });

    later(40_400, () => showRewards(COMPLETED_REWARDS));
    fadeOut(50_000);
  }

  function revealRealOverlay(): void {
    root.hidden = false;
    root.classList.remove('dov-overlay--fading');
    if (!root.classList.contains('dov-overlay--visible')) {
      void root.offsetWidth;
      root.classList.add('dov-overlay--visible');
    }
  }

  function concealRealOverlay(): void {
    root.hidden = true;
    root.classList.remove('dov-overlay--visible', 'dov-overlay--fading');
  }

  function stopJoiningCountdown(): void {
    stopCountdown();
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

    stopJoiningCountdown();
    hideStatus();
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
    entryPresentedRunId = null;
    entryPresentationReadyAt = 0;
    entryWaitTimerScheduled = false;
    activeRunOutageStartedAt = null;
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

  function setRealParticipants(
    participants: Array<DungeonViewerParticipant | DungeonViewerRunParticipant>,
    terminal = false,
    motion?: PlayerMotion
  ): void {
    slots.forEach(resetSlot);
    participants.forEach((participant) => {
      setPlayer(participant.slotNumber - 1, realPlayerFromParticipant(participant, terminal), motion, runLater);
    });
    updatePartyLayout();
    party.classList.remove('dov-party--inside');
  }

  function presentPartyEntryOnce(runId: string, participants: DungeonViewerParticipant[]): boolean {
    if (entryPresentedRunId === runId) {
      root.classList.remove('dov-overlay--terminal');
      root.classList.add('dov-overlay--running');
      party.classList.add('dov-party--inside');
      revealRealOverlay();
      return false;
    }

    setRealParticipants(participants);
    stopCountdown();
    hideStatus();
    hideNotice(runLater);
    joinNoticeQueue = [];
    entryPresentedRunId = runId;
    entryPresentationReadyAt = Date.now() + PLAYER_MOTION_DURATION_MS.arriving;
    entryWaitTimerScheduled = false;
    revealRealOverlay();
    sendPartyInside();
    return true;
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

  function updateCountdownDisplay(activeRun: DungeonViewerActiveRun): void {
    const seconds = countdownDeadline === null ? 0 : Math.max(0, Math.ceil((countdownDeadline - Date.now()) / 1_000));
    if (seconds <= 0) {
      presentPartyEntryOnce(activeRun.id, activeRun.participants);
      return;
    }
    setStatus(seconds, activeRun.joinedPlayers, 'تبدأ الرحلة خلال', activeRun.maxPlayers);
  }

  function startCountdown(activeRun: DungeonViewerActiveRun): void {
    const parsedDeadline = parseApiTimestamp(activeRun.registrationClosesAt);
    if (parsedDeadline !== null) {
      countdownDeadline = parsedDeadline;
    } else if (countdownDeadline === null) {
      countdownDeadline = Date.now() + activeRun.secondsRemaining * 1_000;
    }

    if (countdownTimer !== null) window.clearInterval(countdownTimer);
    updateCountdownDisplay(activeRun);
    if (entryPresentedRunId === activeRun.id) return;
    countdownTimer = window.setInterval(() => {
      if (disposed || !realMode || currentRunStatus !== 'joining') {
        stopCountdown();
        return;
      }
      updateCountdownDisplay(activeRun);
    }, 1_000);
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
    return { icon, text, tone };
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
    showEvent(eventPresentation(event));
    runLater(REAL_EVENT_DURATION_MS, () => {
      if (activeQueuedEvent?.sequenceNumber === event.sequenceNumber) activeQueuedEvent = null;
      hideEvent(runLater);
      runLater(200, () => {
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

  function terminalDescription(summary: DungeonViewerRunSummary, generalRewards: string[]): string {
    const survivors = summary.participants.filter((participant) => participant.survived === true).length;
    const base =
      summary.status === 'completed'
        ? `عاد ${survivors} من المغامرين ومعهم غنائم الرحلة`
        : `نجا ${survivors} من أصل ${summary.participants.length}`;
    return generalRewards.length > 0 ? `${base} • ${generalRewards.join(' • ')}` : base;
  }

  function maybeShowTerminalResult(): void {
    const summary = pendingTerminalSummary;
    if (document.hidden || !summary || eventQueueRunning || eventQueue.length > 0 || terminalPresentationRunning)
      return;
    if (waitForPartyEntry()) return;
    if (displayedTerminalRunIds.has(summary.id)) {
      pendingTerminalSummary = null;
      return;
    }

    pendingTerminalSummary = null;
    terminalPresentationRunning = true;
    activeTerminalSummary = summary;
    hideStatus();
    hideNotice(runLater);
    hideEvent(runLater);
    const visibleParticipants =
      summary.status === 'completed'
        ? summary.participants.filter((participant) => participant.survived === true)
        : summary.participants;
    setRealParticipants(visibleParticipants, true, 'returning');
    const generalRewards = showRealRewards(summary);
    revealRealOverlay();
    showResult(summary.status === 'completed', terminalDescription(summary, generalRewards));

    runLater(REAL_TERMINAL_DURATION_MS, () => {
      root.classList.add('dov-overlay--fading');
      runLater(400, () => {
        if (activeTerminalSummary?.id !== summary.id) return;
        concealRealOverlay();
        activeTerminalSummary = null;
        terminalPresentationRunning = false;
        displayedTerminalRunIds.add(summary.id);
      });
    });
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
    stopCountdown();
    hideStatus();
    hideNotice(runLater);
    joinNoticeQueue = [];

    if (openedDuringRunning) {
      setRealParticipants(activeRun.participants);
      sendPartyInside();
      entryPresentedRunId = activeRun.id;
      entryPresentationReadyAt = 0;
      revealRealOverlay();
    } else if (transitionedFromJoining) {
      presentPartyEntryOnce(activeRun.id, activeRun.participants);
    } else {
      revealRealOverlay();
    }

    const summary = await fetchDungeonRunSummary(activeRun.id, signal);
    const events = await fetchDungeonRunEvents(activeRun.id, signal);
    if (summary.id !== currentRunId) return;
    syncEvents(events, openedDuringRunning);
  }

  async function syncTerminalRun(
    activeRun: DungeonViewerActiveRun,
    signal: AbortSignal,
    openedDuringTerminal: boolean
  ): Promise<void> {
    stopCountdown();
    hideStatus();
    joinNoticeQueue = [];

    if (displayedTerminalRunIds.has(activeRun.id) || terminalPresentationRunning) return;
    const summary = await fetchDungeonRunSummary(activeRun.id, signal);
    if (summary.id !== currentRunId || (summary.status !== 'completed' && summary.status !== 'failed')) return;

    if (openedDuringTerminal && isStaleTerminal(summary)) {
      displayedTerminalRunIds.add(summary.id);
      concealRealOverlay();
      return;
    }

    const events = await fetchDungeonRunEvents(activeRun.id, signal);
    if (summary.id !== currentRunId) return;
    pendingTerminalSummary = summary;
    syncEvents(events, false);
    maybeShowTerminalResult();
  }

  async function handleActiveRun(activeRun: DungeonViewerActiveRun, signal: AbortSignal): Promise<number> {
    const isNewRun = activeRun.id !== currentRunId;
    if (isNewRun) resetRealRunState(activeRun.id);
    const previousStatus = currentRunStatus;

    if (activeRun.status === 'joining') {
      currentRunStatus = 'joining';
      if (entryPresentedRunId === activeRun.id) {
        knownParticipantSlots = new Set(activeRun.participants.map((participant) => participant.slotNumber));
        hideStatus();
        root.classList.remove('dov-overlay--terminal');
        root.classList.add('dov-overlay--running');
        party.classList.add('dov-party--inside');
        revealRealOverlay();
        return REAL_POLL_ACTIVE_MS;
      }
      root.classList.remove('dov-overlay--running', 'dov-overlay--terminal');
      setRealParticipants(activeRun.participants);
      queueJoinNotices(activeRun.participants, isNewRun);
      startCountdown(activeRun);
      revealRealOverlay();
      return REAL_POLL_ACTIVE_MS;
    }

    if (activeRun.status === 'running') {
      const openedDuringRunning = isNewRun;
      const transitionedFromJoining = previousStatus === 'joining';
      currentRunStatus = 'running';
      await syncRunningRun(activeRun, signal, openedDuringRunning, transitionedFromJoining);
      return REAL_POLL_ACTIVE_MS;
    }

    const transitionedFromJoining = previousStatus === 'joining';
    currentRunStatus = activeRun.status;
    if (transitionedFromJoining) {
      presentPartyEntryOnce(activeRun.id, activeRun.participants);
    }
    await syncTerminalRun(activeRun, signal, isNewRun);
    return REAL_POLL_TERMINAL_MS;
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
        nextDelay = handleViewerInterruption();
      } else {
        nextDelay = await handleActiveRun(activeRun, controller.signal);
        activeRunOutageStartedAt = null;
        processJoinNoticeQueue();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        nextDelay = handleViewerInterruption();
      }
    } finally {
      if (requestController === controller) requestController = null;
      pollInFlight = false;
      if (!controller.signal.aborted) scheduleRealPoll(nextDelay);
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

  const searchParams = new URLSearchParams(window.location.search);
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
