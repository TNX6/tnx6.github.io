export type DungeonViewerStatus = 'joining' | 'running' | 'completed' | 'failed';
export type DungeonViewerStage = 'entrance' | 'trap' | 'encounter' | 'treasure' | 'boss' | 'result';
export type DungeonViewerSeverity = 'info' | 'success' | 'warning' | 'danger';

export interface DungeonViewerParticipant {
  slotNumber: number;
  displayName: string;
  level: number | null;
}

export interface DungeonViewerActiveRun {
  id: string;
  status: DungeonViewerStatus;
  serverNow: string | null;
  maxPlayers: number;
  joinedPlayers: number;
  remainingSlots: number;
  registrationClosesAt: string | null;
  secondsRemaining: number;
  participants: DungeonViewerParticipant[];
}

export interface DungeonViewerRunParticipant extends DungeonViewerParticipant {
  status: string;
  survived: boolean | null;
  isOpener: boolean;
}

export interface DungeonViewerMaterialReward {
  itemName: string;
  quantity: number;
}

export interface DungeonViewerPlayerReward {
  displayName: string;
  xp: number;
  materials: DungeonViewerMaterialReward[];
}

export interface DungeonViewerRunSummary {
  id: string;
  status: DungeonViewerStatus;
  serverNow: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: 'completed' | 'failed' | null;
  participants: DungeonViewerRunParticipant[];
  rewards: DungeonViewerPlayerReward[];
}

export interface DungeonViewerEvent {
  sequenceNumber: number;
  stage: DungeonViewerStage;
  title: string;
  message: string;
  severity: DungeonViewerSeverity;
  outcome: string;
  visibleAt: string;
}

const API_BASE = 'https://api.tnx6.xyz';
const SAFE_RUN_ID = /^[A-Za-z0-9._:-]+$/;
const STATUSES = new Set<DungeonViewerStatus>(['joining', 'running', 'completed', 'failed']);
const STAGES = new Set<DungeonViewerStage>(['entrance', 'trap', 'encounter', 'treasure', 'boss', 'result']);
const SEVERITIES = new Set<DungeonViewerSeverity>(['info', 'success', 'warning', 'danger']);

export class DungeonViewerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message);
    this.name = 'DungeonViewerRequestError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DungeonViewerRequestError('Dungeon viewer payload is not an object');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DungeonViewerRequestError(`${label} is not an array`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new DungeonViewerRequestError(`${label} is invalid`);
  }
  return number;
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new DungeonViewerRequestError(`${label} is invalid`);
  }
  const text = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim();
  if (!text) {
    throw new DungeonViewerRequestError(`${label} is empty`);
  }
  return text.slice(0, maximum);
}

function safeRunId(value: unknown): string {
  const runId = safeText(value, 'run id', 128);
  if (!SAFE_RUN_ID.test(runId) || runId.includes('..')) {
    throw new DungeonViewerRequestError('run id is invalid');
  }
  return runId;
}

function safeStatus(value: unknown): DungeonViewerStatus {
  if (typeof value !== 'string' || !STATUSES.has(value as DungeonViewerStatus)) {
    throw new DungeonViewerRequestError('run status is invalid');
  }
  return value as DungeonViewerStatus;
}

export function parseApiTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  if (!source) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
    ? `${source.replace(' ', 'T')}Z`
    : source;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeTimestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = parseApiTimestamp(value);
  if (timestamp === null) {
    throw new DungeonViewerRequestError(`${label} is invalid`);
  }
  return new Date(timestamp).toISOString();
}

function safeOptionalLevel(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return safeInteger(value, 'participant level', 1, 1_000_000);
}

function parseParticipants(value: unknown, includeRunState: false): DungeonViewerParticipant[];
function parseParticipants(value: unknown, includeRunState: true): DungeonViewerRunParticipant[];
function parseParticipants(
  value: unknown,
  includeRunState: boolean
): DungeonViewerParticipant[] | DungeonViewerRunParticipant[] {
  const seenSlots = new Set<number>();
  return asArray(value, 'participants')
    .map((candidate) => {
      const participant = asRecord(candidate);
      const slotNumber = safeInteger(participant.slotNumber, 'participant slot', 1, 6);
      if (seenSlots.has(slotNumber)) {
        throw new DungeonViewerRequestError('participant slot is duplicated');
      }
      seenSlots.add(slotNumber);
      const common: DungeonViewerParticipant = {
        slotNumber,
        displayName: safeText(participant.displayName, 'participant display name', 100),
        level: safeOptionalLevel(participant.level),
      };
      if (!includeRunState) return common;
      const survived = participant.survived;
      if (survived !== null && typeof survived !== 'boolean') {
        throw new DungeonViewerRequestError('participant survived state is invalid');
      }
      return {
        ...common,
        status: safeText(participant.status, 'participant status', 40),
        survived,
        isOpener: participant.isOpener === true,
      };
    })
    .sort((left, right) => left.slotNumber - right.slotNumber);
}

function parseActiveRun(value: unknown): DungeonViewerActiveRun {
  const run = asRecord(value);
  const participants = parseParticipants(run.participants, false);
  const joinedPlayers = safeInteger(run.joinedPlayers, 'joined players', 0, 6);
  const maxPlayers = safeInteger(run.maxPlayers, 'max players', 1, 6);
  if (
    joinedPlayers !== participants.length ||
    participants.some((participant) => participant.slotNumber > maxPlayers)
  ) {
    throw new DungeonViewerRequestError('active participant totals are inconsistent');
  }
  return {
    id: safeRunId(run.id),
    status: safeStatus(run.status),
    serverNow: safeTimestamp(run.serverNow, 'server timestamp'),
    maxPlayers,
    joinedPlayers,
    remainingSlots: Math.max(0, maxPlayers - joinedPlayers),
    registrationClosesAt: safeTimestamp(run.registrationClosesAt, 'registration close timestamp'),
    secondsRemaining: safeInteger(run.secondsRemaining, 'seconds remaining', 0),
    participants,
  };
}

function parseRewards(value: unknown): DungeonViewerPlayerReward[] {
  return asArray(value, 'rewards').map((candidate) => {
    const reward = asRecord(candidate);
    const materials = asArray(reward.materials, 'reward materials').map((materialCandidate) => {
      const material = asRecord(materialCandidate);
      return {
        itemName: safeText(material.itemName, 'material name', 100),
        quantity: safeInteger(material.quantity, 'material quantity', 1),
      };
    });
    return {
      displayName: safeText(reward.displayName, 'reward display name', 100),
      xp: safeInteger(reward.xp, 'reward xp', 0),
      materials,
    };
  });
}

function parseRunSummary(value: unknown): DungeonViewerRunSummary {
  const run = asRecord(value);
  const result = run.result;
  if (result !== null && result !== 'completed' && result !== 'failed') {
    throw new DungeonViewerRequestError('run result is invalid');
  }
  return {
    id: safeRunId(run.id),
    status: safeStatus(run.status),
    serverNow: safeTimestamp(run.serverNow, 'server timestamp'),
    startedAt: safeTimestamp(run.startedAt, 'run start timestamp'),
    completedAt: safeTimestamp(run.completedAt, 'run completion timestamp'),
    result: result as 'completed' | 'failed' | null,
    participants: parseParticipants(run.participants, true),
    rewards: parseRewards(run.rewards),
  };
}

function parseEvents(value: unknown): DungeonViewerEvent[] {
  const seenSequences = new Set<number>();
  return asArray(value, 'events')
    .map((candidate) => {
      const event = asRecord(candidate);
      const sequenceNumber = safeInteger(event.sequenceNumber, 'event sequence', 1);
      if (seenSequences.has(sequenceNumber)) {
        throw new DungeonViewerRequestError('event sequence is duplicated');
      }
      seenSequences.add(sequenceNumber);
      if (typeof event.stage !== 'string' || !STAGES.has(event.stage as DungeonViewerStage)) {
        throw new DungeonViewerRequestError('event stage is invalid');
      }
      if (typeof event.severity !== 'string' || !SEVERITIES.has(event.severity as DungeonViewerSeverity)) {
        throw new DungeonViewerRequestError('event severity is invalid');
      }
      const visibleAt = safeTimestamp(event.visibleAt, 'event visibility timestamp');
      if (!visibleAt) {
        throw new DungeonViewerRequestError('event visibility timestamp is missing');
      }
      return {
        sequenceNumber,
        stage: event.stage as DungeonViewerStage,
        title: safeText(event.title, 'event title', 200),
        message: safeText(event.message, 'event message', 400),
        severity: event.severity as DungeonViewerSeverity,
        outcome: safeText(event.outcome, 'event outcome', 100),
        visibleAt,
      };
    })
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    .slice(0, 50);
}

async function requestJson(path: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new DungeonViewerRequestError('Dungeon viewer request failed', response.status);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DungeonViewerRequestError('Dungeon viewer response is not valid JSON', response.status);
  }
  const record = asRecord(payload);
  if (record.ok !== true) {
    throw new DungeonViewerRequestError('Dungeon viewer response was not successful', response.status);
  }
  return record;
}

export async function fetchActiveDungeonRun(signal: AbortSignal): Promise<DungeonViewerActiveRun | null> {
  const payload = await requestJson('/api/dungeon/viewer/active', signal);
  return payload.run === null ? null : parseActiveRun(payload.run);
}

export async function fetchDungeonRunSummary(runId: string, signal: AbortSignal): Promise<DungeonViewerRunSummary> {
  const safeId = safeRunId(runId);
  const payload = await requestJson(`/api/dungeon/viewer/runs/${encodeURIComponent(safeId)}`, signal);
  const summary = parseRunSummary(payload.run);
  if (summary.id !== safeId) {
    throw new DungeonViewerRequestError('Dungeon run summary does not match the requested run');
  }
  return summary;
}

export async function fetchDungeonRunEvents(runId: string, signal: AbortSignal): Promise<DungeonViewerEvent[]> {
  const safeId = safeRunId(runId);
  const payload = await requestJson(`/api/dungeon/viewer/runs/${encodeURIComponent(safeId)}/events`, signal);
  if (safeRunId(payload.runId) !== safeId) {
    throw new DungeonViewerRequestError('Dungeon events do not match the requested run');
  }
  return parseEvents(payload.events);
}

export async function advanceDungeonRunIfDue(runId: string, signal: AbortSignal): Promise<void> {
  const safeId = safeRunId(runId);
  const response = await fetch(`${API_BASE}/api/dungeon/runs/${encodeURIComponent(safeId)}/advance-if-due`, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new DungeonViewerRequestError('Dungeon lifecycle nudge failed', response.status);
  }
  const payload = asRecord(await response.json());
  if (payload.ok !== true || safeRunId(payload.runId) !== safeId) {
    throw new DungeonViewerRequestError('Dungeon lifecycle nudge response is invalid', response.status);
  }
}
