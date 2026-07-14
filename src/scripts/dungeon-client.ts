const DUNGEON_API_BASE = 'https://api.tnx6.xyz';
const DUNGEON_LOGIN_URL = `${DUNGEON_API_BASE}/auth/twitch/login`;
const TOTAL_VISIBLE_SLOTS = 6;
const NO_RUN_POLL_MS = 10_000;
const ACTIVE_POLL_MS = 3_000;
const TERMINAL_POLL_MS = 15_000;

type RunStatus = 'joining' | 'running' | 'completed' | 'failed';
type ViewMode = 'loading' | 'no-run' | 'joining' | 'running' | 'terminal' | 'unavailable' | 'error';
type JoinStateKind = 'idle' | 'pending' | 'joined' | 'replayed' | 'guest' | 'full' | 'closed' | 'unavailable' | 'error';

interface ActiveParticipant {
  slotNumber: number;
  displayName: string;
}

interface ActiveRun {
  id: string;
  status: RunStatus;
  maxPlayers: number;
  joinedPlayers: number;
  remainingSlots: number;
  registrationClosesAt: string | null;
  secondsRemaining: number;
  participants: ActiveParticipant[];
}

interface RunParticipant extends ActiveParticipant {
  status: string;
  survived: boolean | null;
  isOpener: boolean;
}

interface MaterialReward {
  itemKey: string;
  itemName: string;
  quantity: number;
}

interface PlayerReward {
  displayName: string;
  xp: number;
  materials: MaterialReward[];
}

interface RunView {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  result: 'completed' | 'failed' | null;
  participants: RunParticipant[];
  rewards: PlayerReward[];
}

interface EventPlayer extends ActiveParticipant {
  outcome: string | null;
}

interface DungeonEvent {
  sequenceNumber: number;
  eventType: 'dungeon_stage' | 'run_status';
  stage: 'entrance' | 'trap' | 'encounter' | 'treasure' | 'boss' | 'result';
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'danger';
  iconKey: string;
  outcome: string;
  visibleAt: string;
  players: EventPlayer[];
}

interface JoinState {
  kind: JoinStateKind;
  slotNumber: number | null;
}

interface DungeonClientWindow extends Window {
  __tnxDungeonCleanup?: () => void;
}

class DungeonRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super('Dungeon request failed');
    this.name = 'DungeonRequestError';
  }
}

const stageLabels: Record<DungeonEvent['stage'], string> = {
  entrance: 'بوابة الدنجن',
  trap: 'ممر الفخاخ',
  encounter: 'مواجهة الظلال',
  treasure: 'غرفة الكنز',
  boss: 'حارس الأعماق',
  result: 'النتيجة',
};

const stageIcons: Record<DungeonEvent['stage'], string> = {
  entrance: 'tabler:door-enter',
  trap: 'tabler:alert-triangle',
  encounter: 'tabler:swords',
  treasure: 'tabler:chest',
  boss: 'tabler:shield',
  result: 'tabler:flag-3',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid dungeon response');
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid dungeon response');
  return number;
}

function positiveInteger(value: unknown): number {
  const number = nonNegativeInteger(value);
  if (number < 1) throw new Error('Invalid dungeon response');
  return number;
}

function runStatus(value: unknown): RunStatus {
  if (value === 'joining' || value === 'running' || value === 'completed' || value === 'failed') return value;
  throw new Error('Invalid dungeon response');
}

function safeDisplayName(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : 'غير معروف';
}

function parseActiveParticipant(value: unknown): ActiveParticipant {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    slotNumber: positiveInteger(record.slotNumber),
    displayName: safeDisplayName(record.displayName),
  };
}

function parseActiveRun(value: unknown): ActiveRun {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    id: requiredString(record.id),
    status: runStatus(record.status),
    maxPlayers: positiveInteger(record.maxPlayers),
    joinedPlayers: nonNegativeInteger(record.joinedPlayers),
    remainingSlots: nonNegativeInteger(record.remainingSlots),
    registrationClosesAt: nullableString(record.registrationClosesAt),
    secondsRemaining: nonNegativeInteger(record.secondsRemaining),
    participants: Array.isArray(record.participants) ? record.participants.map(parseActiveParticipant) : [],
  };
}

function parseRunParticipant(value: unknown): RunParticipant {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    slotNumber: positiveInteger(record.slotNumber),
    displayName: safeDisplayName(record.displayName),
    status: typeof record.status === 'string' ? record.status : 'active',
    survived: record.survived === true ? true : record.survived === false ? false : null,
    isOpener: record.isOpener === true,
  };
}

function parseMaterialReward(value: unknown): MaterialReward {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    itemKey: requiredString(record.itemKey),
    itemName: safeDisplayName(record.itemName),
    quantity: positiveInteger(record.quantity),
  };
}

function parsePlayerReward(value: unknown): PlayerReward {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    displayName: safeDisplayName(record.displayName),
    xp: nonNegativeInteger(record.xp),
    materials: Array.isArray(record.materials) ? record.materials.map(parseMaterialReward) : [],
  };
}

function parseRunView(value: unknown): RunView {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  const result = record.result === 'completed' || record.result === 'failed' ? record.result : null;
  return {
    id: requiredString(record.id),
    status: runStatus(record.status),
    startedAt: nullableString(record.startedAt),
    completedAt: nullableString(record.completedAt),
    result,
    participants: Array.isArray(record.participants) ? record.participants.map(parseRunParticipant) : [],
    rewards: Array.isArray(record.rewards) ? record.rewards.map(parsePlayerReward) : [],
  };
}

function parseEventPlayer(value: unknown): EventPlayer {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  return {
    slotNumber: positiveInteger(record.slotNumber),
    displayName: safeDisplayName(record.displayName),
    outcome: nullableString(record.outcome),
  };
}

function parseDungeonEvent(value: unknown): DungeonEvent {
  const record = asRecord(value);
  if (!record) throw new Error('Invalid dungeon response');
  const stage = record.stage;
  const eventType = record.eventType;
  const severity = record.severity;
  if (
    !(
      stage === 'entrance' ||
      stage === 'trap' ||
      stage === 'encounter' ||
      stage === 'treasure' ||
      stage === 'boss' ||
      stage === 'result'
    )
  ) {
    throw new Error('Invalid dungeon response');
  }
  if (!(eventType === 'dungeon_stage' || eventType === 'run_status')) throw new Error('Invalid dungeon response');
  if (!(severity === 'info' || severity === 'success' || severity === 'warning' || severity === 'danger')) {
    throw new Error('Invalid dungeon response');
  }
  return {
    sequenceNumber: positiveInteger(record.sequenceNumber),
    eventType,
    stage,
    title: requiredString(record.title).slice(0, 180),
    message: requiredString(record.message).slice(0, 600),
    severity,
    iconKey: typeof record.iconKey === 'string' ? record.iconKey.slice(0, 100) : '',
    outcome: typeof record.outcome === 'string' ? record.outcome.slice(0, 80) : '',
    visibleAt: requiredString(record.visibleAt),
    players: Array.isArray(record.players) ? record.players.map(parseEventPlayer) : [],
  };
}

async function readResponseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  return asRecord(body) || {};
}

function responseError(response: Response, body: Record<string, unknown>): DungeonRequestError {
  const error = asRecord(body.error);
  const code = typeof error?.code === 'string' ? error.code : '';
  return new DungeonRequestError(response.status, code);
}

async function fetchActiveRun(signal: AbortSignal): Promise<ActiveRun | null> {
  const response = await fetch(`${DUNGEON_API_BASE}/api/dungeon/viewer/active`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await readResponseBody(response);
  if (!response.ok) throw responseError(response, body);
  if (body.run === null) return null;
  return parseActiveRun(body.run);
}

async function fetchRunView(runId: string, signal: AbortSignal): Promise<RunView> {
  const response = await fetch(`${DUNGEON_API_BASE}/api/dungeon/viewer/runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await readResponseBody(response);
  if (!response.ok) throw responseError(response, body);
  return parseRunView(body.run);
}

async function fetchRunEvents(runId: string, signal: AbortSignal): Promise<DungeonEvent[]> {
  const response = await fetch(`${DUNGEON_API_BASE}/api/dungeon/viewer/runs/${encodeURIComponent(runId)}/events`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body = await readResponseBody(response);
  if (!response.ok) throw responseError(response, body);
  const events = Array.isArray(body.events) ? body.events.map(parseDungeonEvent) : [];
  return events.sort((left, right) => left.sequenceNumber - right.sequenceNumber).slice(-50);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name: string): HTMLElement {
  const node = document.createElement('iconify-icon');
  node.setAttribute('icon', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function numberText(value: number): string {
  return new Intl.NumberFormat('ar-SA-u-nu-latn').format(value);
}

function parseApiTimestamp(value: string | null): number {
  if (!value) return Number.NaN;
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const sqliteUtc = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(trimmed);
  const normalized = sqliteUtc ? `${sqliteUtc[1]}T${sqliteUtc[2]}${sqliteUtc[3] || ''}Z` : trimmed;
  return Date.parse(normalized);
}

function timeText(value: string | null): string {
  const timestamp = parseApiTimestamp(value);
  if (!Number.isFinite(timestamp)) return 'غير محدد';
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function initials(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 1).toUpperCase() : '؟';
}

function statusBadge(status: RunStatus): HTMLElement {
  const labels: Record<RunStatus, string> = {
    joining: 'التسجيل مفتوح',
    running: 'الرحلة جارية',
    completed: 'اكتملت الرحلة',
    failed: 'انتهت بالفشل',
  };
  return element('span', `dungeon-status-badge dungeon-status-badge--${status}`, labels[status]);
}

function statusPanel(status: RunStatus, title: string, description: string, iconName: string): HTMLElement {
  const panel = element('section', 'dungeon-status-panel');
  panel.setAttribute('aria-labelledby', 'dungeonCurrentStatusTitle');
  const head = element('div', 'dungeon-status-panel__head');
  const titleWrap = element('div', 'dungeon-status-panel__title');
  const mark = element('span');
  mark.append(icon(iconName));
  const copy = element('div');
  const heading = element('h2', '', title);
  heading.id = 'dungeonCurrentStatusTitle';
  copy.append(heading, element('p', '', description));
  titleWrap.append(mark, copy);
  head.append(titleWrap, statusBadge(status));
  panel.append(head);
  return panel;
}

function metric(label: string, value: string, className = ''): HTMLElement {
  const wrapper = element('div', 'dungeon-metric');
  wrapper.append(element('span', '', label), element('strong', className, value));
  return wrapper;
}

function sectionHeading(kicker: string, title: string, count?: number): HTMLElement {
  const heading = element('div', 'dungeon-section-heading');
  const copy = element('div');
  copy.append(element('p', 'dungeon-section-kicker', kicker), element('h2', '', title));
  heading.append(copy);
  if (count !== undefined) heading.append(element('span', 'dungeon-section-count', numberText(count)));
  return heading;
}

function playerState(participant: RunParticipant | null): { label: string; className: string } {
  if (!participant) return { label: 'داخل الرحلة', className: '' };
  if (participant.survived === true) return { label: 'نجا', className: 'dungeon-player-tag--alive' };
  if (participant.survived === false) return { label: 'مات', className: 'dungeon-player-tag--dead' };
  if (participant.status === 'dead' || participant.status === 'left') {
    return { label: participant.status === 'dead' ? 'مات' : 'غادر', className: 'dungeon-player-tag--dead' };
  }
  return { label: 'داخل الرحلة', className: '' };
}

function playerSlot(
  slotNumber: number,
  participant: ActiveParticipant | RunParticipant | null,
  terminal = false
): HTMLElement {
  const terminalParticipant = participant && 'survived' in participant ? participant : null;
  const isDead = terminalParticipant?.survived === false;
  const card = element(
    'article',
    `dungeon-player-slot${participant ? '' : ' dungeon-player-slot--empty'}${isDead ? ' dungeon-player-slot--dead' : ''}`
  );
  const avatar = element(
    'span',
    'dungeon-player-avatar',
    participant ? initials(participant.displayName) : numberText(slotNumber)
  );
  avatar.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'dungeon-player-copy');
  copy.append(
    element('strong', '', participant ? participant.displayName : 'مقعد متاح'),
    element('span', '', `المقعد ${numberText(slotNumber)}`)
  );
  card.append(avatar, copy);

  if (participant) {
    const isOpener = 'isOpener' in participant ? participant.isOpener : slotNumber === 1;
    if (terminal) {
      const state = playerState(terminalParticipant);
      card.append(element('span', `dungeon-player-tag ${state.className}`, state.label));
    } else if (isOpener) {
      card.append(element('span', 'dungeon-player-tag', 'صاحب الفتح'));
    }
  }
  return card;
}

function playersPanel(
  participants: Array<ActiveParticipant | RunParticipant>,
  includeEmptySlots: boolean,
  terminal = false
): HTMLElement {
  const panel = element('section', 'dungeon-panel');
  panel.setAttribute('aria-label', 'المشاركون في الرحلة');
  panel.append(sectionHeading('الفريق', terminal ? 'نتائج المشاركين' : 'المشاركون والمقاعد', participants.length));
  const grid = element('div', 'dungeon-players-grid');
  const bySlot = new Map(participants.map((participant) => [participant.slotNumber, participant]));
  const total = includeEmptySlots ? TOTAL_VISIBLE_SLOTS : Math.max(1, ...participants.map((item) => item.slotNumber));
  for (let slot = 1; slot <= total; slot += 1) {
    const participant = bySlot.get(slot) || null;
    if (!includeEmptySlots && !participant) continue;
    grid.append(playerSlot(slot, participant, terminal));
  }
  panel.append(grid);
  return panel;
}

function timelinePanel(events: DungeonEvent[], terminal: boolean): HTMLElement {
  const panel = element('section', 'dungeon-panel');
  panel.setAttribute('aria-label', 'أحداث رحلة الدنجن');
  panel.append(sectionHeading('السجل المباشر', terminal ? 'جميع أحداث الرحلة' : 'أحداث الرحلة', events.length));
  if (events.length === 0) {
    panel.append(element('div', 'dungeon-empty-section', 'لم تظهر أحداث الرحلة بعد.'));
    return panel;
  }

  const list = element('ol', 'dungeon-timeline');
  events.forEach((event, index) => {
    const item = element('li', `dungeon-event${index === events.length - 1 ? ' dungeon-event--latest' : ''}`);
    const mark = element('span', 'dungeon-event__mark');
    mark.append(icon(stageIcons[event.stage]));
    const content = element('div', 'dungeon-event__content');
    const meta = element('div', 'dungeon-event__meta');
    meta.append(
      element('span', 'dungeon-event__stage', stageLabels[event.stage]),
      element('span', 'dungeon-event__sequence', `#${numberText(event.sequenceNumber)}`)
    );
    content.append(meta, element('h3', '', event.title), element('p', '', event.message));

    if (event.players.length > 0) {
      const eventPlayers = element('div', 'dungeon-event__players');
      event.players.forEach((player) => {
        eventPlayers.append(element('span', 'dungeon-event__player', player.displayName));
      });
      content.append(eventPlayers);
    }

    item.append(mark, content);
    list.append(item);
  });
  panel.append(list);
  return panel;
}

function rewardsPanel(rewards: PlayerReward[]): HTMLElement {
  const panel = element('section', 'dungeon-panel');
  panel.setAttribute('aria-label', 'مكافآت رحلة الدنجن');
  panel.append(sectionHeading('الغنائم', 'المكافآت', rewards.length));
  if (rewards.length === 0) {
    panel.append(element('div', 'dungeon-empty-section', 'لا توجد مكافآت مسجلة لهذه الرحلة.'));
    return panel;
  }

  const grid = element('div', 'dungeon-rewards');
  rewards.forEach((reward) => {
    const card = element('article', 'dungeon-reward-card');
    const head = element('div', 'dungeon-reward-card__head');
    head.append(element('h3', '', reward.displayName), element('span', 'dungeon-xp', `${numberText(reward.xp)} XP`));
    card.append(head);
    if (reward.materials.length > 0) {
      const materials = element('ul', 'dungeon-materials');
      reward.materials.forEach((material) => {
        const row = element('li', 'dungeon-material');
        row.append(element('span', '', material.itemName), element('strong', '', `×${numberText(material.quantity)}`));
        materials.append(row);
      });
      card.append(materials);
    } else {
      card.append(element('div', 'dungeon-empty-section', 'XP فقط'));
    }
    grid.append(card);
  });
  panel.append(grid);
  return panel;
}

function stateCard(iconName: string, title: string, description: string): HTMLElement {
  const card = element('section', 'dungeon-state-card');
  const mark = element('span', 'dungeon-state-card__icon');
  mark.append(icon(iconName));
  const copy = element('div', 'dungeon-state-card__copy');
  copy.append(element('h2', '', title), element('p', '', description));
  card.append(mark, copy);
  return card;
}

function countdownValue(closesAt: string | null, fallbackSeconds: number): number {
  const timestamp = parseApiTimestamp(closesAt);
  if (Number.isFinite(timestamp)) return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  return Math.max(0, fallbackSeconds);
}

function countdownText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const parts = hours > 0 ? [hours, minutes, remaining] : [minutes, remaining];
  return parts.map((part) => String(part).padStart(2, '0')).join(':');
}

function initDungeonPage(): void {
  const root = document.getElementById('dungeonApp');
  const view = document.getElementById('dungeonView');
  const liveRegion = document.getElementById('dungeonLiveRegion');
  if (!root || !view || !liveRegion) return;
  const viewElement = view;
  const liveRegionElement = liveRegion;

  const clientWindow = window as DungeonClientWindow;
  clientWindow.__tnxDungeonCleanup?.();

  let destroyed = false;
  let paused = document.hidden;
  let mode: ViewMode = 'loading';
  let currentRunId: string | null = null;
  let currentActiveRun: ActiveRun | null = null;
  let joinState: JoinState = { kind: 'idle', slotNumber: null };
  let pollTimer = 0;
  let countdownTimer = 0;
  let polling = false;
  let immediatePollRequested = false;
  let pollController: AbortController | null = null;
  let joinController: AbortController | null = null;
  let lastAnnouncement = '';
  const cleanups: Array<() => void> = [];

  function on(target: EventTarget, eventName: string, listener: EventListener): void {
    target.addEventListener(eventName, listener);
    cleanups.push(() => target.removeEventListener(eventName, listener));
  }

  function announce(message: string): void {
    if (message === lastAnnouncement) return;
    lastAnnouncement = message;
    liveRegionElement.textContent = message;
  }

  function replaceView(node: HTMLElement): void {
    const activeElement = document.activeElement;
    const activeElementId =
      activeElement instanceof HTMLElement && viewElement.contains(activeElement) ? activeElement.id : '';

    viewElement.replaceChildren(node);
    viewElement.setAttribute('aria-busy', 'false');

    if (!activeElementId) return;
    const replacement = document.getElementById(activeElementId);
    if (replacement instanceof HTMLElement && viewElement.contains(replacement)) {
      replacement.focus({ preventScroll: true });
    }
  }

  function clearCountdown(): void {
    if (countdownTimer) window.clearInterval(countdownTimer);
    countdownTimer = 0;
  }

  function resetRunState(runId: string | null): void {
    currentRunId = runId;
    joinState = { kind: 'idle', slotNumber: null };
    clearCountdown();
  }

  function renderNoRun(): void {
    mode = 'no-run';
    const card = stateCard(
      'tabler:door-off',
      'الدنجن مغلق حاليًا',
      'عند استخدام مكافأة فتح الدنجن في Twitch ستظهر الرحلة هنا تلقائيًا.'
    );
    const facts = element('ul', 'dungeon-state-card__facts');
    facts.append(element('li', '', 'لا توجد رحلة نشطة.'), element('li', '', 'تابع البث لمعرفة موعد فتح الدنجن.'));
    card.append(facts);
    replaceView(card);
    announce('الدنجن مغلق حاليًا. لا توجد رحلة نشطة.');
  }

  function renderViewerUnavailable(): void {
    mode = 'unavailable';
    const card = stateCard(
      'tabler:lock',
      'عرض الدنجن غير متاح حاليًا',
      'سنحاول التحقق من حالة الرحلات مرة أخرى بعد قليل.'
    );
    replaceView(card);
    announce('عرض الدنجن غير متاح حاليًا.');
  }

  function requestImmediatePoll(): void {
    immediatePollRequested = true;
    if (!polling && !paused && !destroyed) schedulePoll(0);
  }

  function renderConnectionError(): void {
    mode = 'error';
    const card = stateCard('tabler:wifi-off', 'تعذر الاتصال بالدنجن', 'تحقق من اتصالك أو حاول مرة أخرى بعد قليل.');
    const retry = element('button', 'dungeon-retry', 'إعادة المحاولة');
    retry.id = 'dungeonRetryButton';
    retry.type = 'button';
    retry.addEventListener('click', requestImmediatePoll, { once: true });
    card.append(retry);
    replaceView(card);
    announce('تعذر الاتصال ببيانات الدنجن.');
  }

  function joinFeedback(): HTMLElement {
    const wrapper = element('div');
    wrapper.setAttribute('role', 'status');
    wrapper.setAttribute('aria-live', 'polite');
    const messages: Record<JoinStateKind, { text: string; tone: string }> = {
      idle: { text: 'سجل مقعدك قبل انتهاء الوقت.', tone: '' },
      pending: { text: 'جاري تسجيل مقعدك...', tone: '' },
      joined: {
        text: `تم تسجيلك في المقعد رقم ${numberText(joinState.slotNumber || 0)}`,
        tone: 'dungeon-join-feedback--success',
      },
      replayed: {
        text: `أنت مسجل مسبقًا في المقعد رقم ${numberText(joinState.slotNumber || 0)}`,
        tone: 'dungeon-join-feedback--success',
      },
      guest: { text: 'سجل دخولك بحساب Twitch أولًا', tone: 'dungeon-join-feedback--warning' },
      full: { text: 'اكتملت جميع المقاعد', tone: 'dungeon-join-feedback--warning' },
      closed: { text: 'انتهى وقت التسجيل', tone: 'dungeon-join-feedback--warning' },
      unavailable: { text: 'الانضمام غير متاح حاليًا.', tone: 'dungeon-join-feedback--warning' },
      error: { text: 'تعذر الانضمام، حاول مرة أخرى', tone: 'dungeon-join-feedback--error' },
    };
    const feedback = messages[joinState.kind];
    wrapper.append(element('p', `dungeon-join-feedback ${feedback.tone}`, feedback.text));
    if (joinState.kind === 'guest') {
      const login = element('a', 'dungeon-login-link', 'تسجيل الدخول عبر Twitch');
      login.id = 'dungeonLoginLink';
      login.href = DUNGEON_LOGIN_URL;
      wrapper.append(login);
    }
    return wrapper;
  }

  function updateJoiningCountdown(): boolean {
    if (!currentActiveRun || currentActiveRun.status !== 'joining') return false;
    const seconds = countdownValue(currentActiveRun.registrationClosesAt, currentActiveRun.secondsRemaining);
    const countdown = document.getElementById('dungeonCountdown');
    const button = document.getElementById('dungeonJoinButton') as HTMLButtonElement | null;
    if (countdown) countdown.textContent = countdownText(seconds);
    if (button && seconds <= 0) {
      button.disabled = true;
      button.textContent = 'انتهى وقت التسجيل';
      if (joinState.kind === 'idle') {
        joinState = { kind: 'closed', slotNumber: null };
        renderJoining(currentActiveRun);
      }
      requestImmediatePoll();
      return false;
    }
    return true;
  }

  function startJoiningCountdown(): void {
    clearCountdown();
    if (updateJoiningCountdown()) countdownTimer = window.setInterval(updateJoiningCountdown, 1000);
  }

  function joinButtonState(active: ActiveRun): { disabled: boolean; label: string } {
    const seconds = countdownValue(active.registrationClosesAt, active.secondsRemaining);
    if (seconds <= 0 || joinState.kind === 'closed') return { disabled: true, label: 'انتهى وقت التسجيل' };
    if (active.remainingSlots <= 0 || joinState.kind === 'full') return { disabled: true, label: 'اكتملت المقاعد' };
    if (joinState.kind === 'pending') return { disabled: true, label: 'جاري الانضمام...' };
    if (joinState.kind === 'joined' || joinState.kind === 'replayed')
      return { disabled: true, label: 'تم تسجيل مقعدك' };
    if (joinState.kind === 'unavailable') return { disabled: true, label: 'الانضمام غير متاح' };
    return { disabled: false, label: 'انضم إلى الرحلة' };
  }

  function renderJoining(active: ActiveRun): void {
    mode = 'joining';
    currentActiveRun = active;
    const dashboard = element('div', 'dungeon-dashboard');
    const status = statusPanel('joining', 'باب التسجيل مفتوح', 'اختر مقعدك قبل أن تبدأ الرحلة.', 'tabler:door-enter');
    const metrics = element('div', 'dungeon-metrics');
    const countdownMetric = metric(
      'الوقت المتبقي',
      countdownText(countdownValue(active.registrationClosesAt, active.secondsRemaining)),
      'dungeon-countdown'
    );
    countdownMetric.querySelector('strong')!.id = 'dungeonCountdown';
    metrics.append(
      countdownMetric,
      metric(
        'اللاعبون',
        `${numberText(active.joinedPlayers)} / ${numberText(active.maxPlayers)}`,
        'dungeon-number-ltr'
      ),
      metric('المقاعد المتبقية', numberText(active.remainingSlots))
    );
    status.append(metrics);

    const joinArea = element('div', 'dungeon-join-area');
    const buttonState = joinButtonState(active);
    const joinButton = element('button', 'dungeon-join-button', buttonState.label);
    joinButton.id = 'dungeonJoinButton';
    joinButton.type = 'button';
    joinButton.disabled = buttonState.disabled;
    joinButton.addEventListener('click', () => void joinCurrentRun());
    joinArea.append(joinFeedback(), joinButton);
    status.append(joinArea);

    const mainGrid = element('div', 'dungeon-main-grid dungeon-main-grid--single');
    mainGrid.append(playersPanel(active.participants, true));
    dashboard.append(status, mainGrid);
    replaceView(dashboard);
    startJoiningCountdown();
    announce(`التسجيل مفتوح. ${numberText(active.remainingSlots)} مقاعد متبقية.`);
  }

  function renderRunning(active: ActiveRun, run: RunView, events: DungeonEvent[]): void {
    mode = 'running';
    clearCountdown();
    const dashboard = element('div', 'dungeon-dashboard');
    const status = statusPanel(
      'running',
      'الرحلة جارية',
      'تظهر الأحداث هنا فور وصولها إلى المشاهدين.',
      'tabler:swords'
    );
    const metrics = element('div', 'dungeon-metrics');
    metrics.append(
      metric('المشاركون', numberText(run.participants.length || active.joinedPlayers)),
      metric('بدأت عند', timeText(run.startedAt)),
      metric('آخر تحديث', timeText(new Date().toISOString()))
    );
    status.append(metrics);
    const mainGrid = element('div', 'dungeon-main-grid');
    const participants = run.participants.length > 0 ? run.participants : active.participants;
    mainGrid.append(playersPanel(participants, false), timelinePanel(events, false));
    dashboard.append(status, mainGrid);
    replaceView(dashboard);
    announce(`الرحلة جارية. وصل عدد الأحداث الظاهرة إلى ${numberText(events.length)}.`);
  }

  function renderTerminal(run: RunView, events: DungeonEvent[]): void {
    mode = 'terminal';
    clearCountdown();
    const completed = run.status === 'completed';
    const dashboard = element('div', 'dungeon-dashboard');
    const status = statusPanel(
      run.status,
      completed ? 'اكتملت الرحلة بنجاح' : 'فشلت الرحلة',
      completed ? 'تم تسجيل نتائج الفريق ومكافآته.' : 'انتهت المحاولة وتم تسجيل نتائج المشاركين.',
      completed ? 'tabler:trophy' : 'tabler:skull'
    );
    const metrics = element('div', 'dungeon-metrics');
    metrics.append(
      metric('المشاركون', numberText(run.participants.length)),
      metric('بدأت عند', timeText(run.startedAt)),
      metric('انتهت عند', timeText(run.completedAt))
    );
    status.append(metrics);
    const result = element(
      'div',
      `dungeon-result-banner${completed ? '' : ' dungeon-result-banner--failed'}`,
      completed ? 'اكتملت الرحلة بنجاح' : 'فشلت الرحلة'
    );
    result.prepend(icon(completed ? 'tabler:circle-check' : 'tabler:circle-x'));
    status.append(result);

    const summaryGrid = element('div', 'dungeon-main-grid');
    summaryGrid.append(playersPanel(run.participants, false, true), rewardsPanel(run.rewards));
    dashboard.append(status, summaryGrid, timelinePanel(events, true));
    replaceView(dashboard);
    announce(completed ? 'اكتملت رحلة الدنجن بنجاح.' : 'انتهت رحلة الدنجن بالفشل.');
  }

  async function joinCurrentRun(): Promise<void> {
    const runId = currentRunId;
    const active = currentActiveRun;
    if (!runId || !active || active.status !== 'joining' || joinState.kind === 'pending') return;
    if (countdownValue(active.registrationClosesAt, active.secondsRemaining) <= 0) {
      joinState = { kind: 'closed', slotNumber: null };
      renderJoining(active);
      return;
    }

    joinState = { kind: 'pending', slotNumber: null };
    renderJoining(active);
    joinController?.abort();
    joinController = new AbortController();

    try {
      const response = await fetch(`${DUNGEON_API_BASE}/api/dungeon/runs/${encodeURIComponent(runId)}/join`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: joinController.signal,
      });
      const body = await readResponseBody(response);
      if (destroyed || currentRunId !== runId) return;

      if (response.ok) {
        const slotNumber = positiveInteger(body.slotNumber);
        joinState = { kind: body.replayed === true ? 'replayed' : 'joined', slotNumber };
      } else {
        const requestError = responseError(response, body);
        if (requestError.status === 401 || requestError.code === 'DUNGEON_PLAYER_UNAUTHENTICATED') {
          joinState = { kind: 'guest', slotNumber: null };
        } else if (requestError.code === 'DUNGEON_RUN_FULL') {
          joinState = { kind: 'full', slotNumber: null };
        } else if (
          requestError.code === 'DUNGEON_REGISTRATION_CLOSED' ||
          requestError.code === 'DUNGEON_RUN_NOT_JOINING'
        ) {
          joinState = { kind: 'closed', slotNumber: null };
        } else if (requestError.status === 404 || requestError.code === 'DUNGEON_PLAYER_ROUTES_DISABLED') {
          joinState = { kind: 'unavailable', slotNumber: null };
        } else {
          joinState = { kind: 'error', slotNumber: null };
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (!destroyed && currentRunId === runId && joinState.kind === 'pending') {
          joinState = { kind: 'idle', slotNumber: null };
        }
        return;
      }
      if (!destroyed && currentRunId === runId) joinState = { kind: 'error', slotNumber: null };
    } finally {
      joinController = null;
      if (!destroyed && !paused && currentRunId === runId && currentActiveRun?.status === 'joining') {
        renderJoining(currentActiveRun);
        requestImmediatePoll();
      }
    }
  }

  async function loadCurrentState(signal: AbortSignal): Promise<void> {
    const active = await fetchActiveRun(signal);
    if (!active) {
      if (currentRunId !== null) resetRunState(null);
      currentActiveRun = null;
      renderNoRun();
      return;
    }

    if (active.id !== currentRunId) resetRunState(active.id);
    currentActiveRun = active;

    if (active.status === 'joining') {
      renderJoining(active);
      return;
    }

    const [run, events] = await Promise.all([fetchRunView(active.id, signal), fetchRunEvents(active.id, signal)]);
    if (active.id !== currentRunId) return;
    if (run.status === 'completed' || run.status === 'failed') renderTerminal(run, events);
    else renderRunning(active, run, events);
  }

  function pollDelay(): number {
    if (mode === 'joining' || mode === 'running') return ACTIVE_POLL_MS;
    if (mode === 'terminal') return TERMINAL_POLL_MS;
    return NO_RUN_POLL_MS;
  }

  function schedulePoll(delay: number): void {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = 0;
    if (destroyed || paused) return;
    pollTimer = window.setTimeout(() => void poll(), delay);
  }

  async function poll(): Promise<void> {
    if (destroyed || paused || polling) return;
    polling = true;
    immediatePollRequested = false;
    pollController?.abort();
    pollController = new AbortController();

    try {
      await loadCurrentState(pollController.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof DungeonRequestError && error.status === 404) renderViewerUnavailable();
      else renderConnectionError();
    } finally {
      polling = false;
      pollController = null;
      if (!destroyed && !paused) {
        const delay = immediatePollRequested ? 0 : pollDelay();
        immediatePollRequested = false;
        schedulePoll(delay);
      }
    }
  }

  function pause(): void {
    paused = true;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = 0;
    clearCountdown();
    pollController?.abort();
    pollController = null;
    joinController?.abort();
    joinController = null;
  }

  function resume(): void {
    if (destroyed || document.hidden) return;
    paused = false;
    schedulePoll(0);
  }

  function cleanup(): void {
    if (destroyed) return;
    destroyed = true;
    pause();
    cleanups.forEach((remove) => remove());
    cleanups.length = 0;
    if (clientWindow.__tnxDungeonCleanup === cleanup) delete clientWindow.__tnxDungeonCleanup;
  }

  on(document, 'visibilitychange', () => {
    if (document.hidden) pause();
    else resume();
  });
  on(window, 'pagehide', pause);
  on(window, 'pageshow', resume);
  on(window, 'beforeunload', cleanup);
  on(document, 'astro:before-swap', cleanup);

  clientWindow.__tnxDungeonCleanup = cleanup;
  if (!paused) schedulePoll(0);
}

function bootDungeonPage(): void {
  if (document.getElementById('dungeonApp')) initDungeonPage();
}

document.addEventListener('astro:page-load', bootDungeonPage);
bootDungeonPage();
