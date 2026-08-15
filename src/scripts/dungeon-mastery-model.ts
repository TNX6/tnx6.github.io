export const DUNGEON_MASTERY_ROUTE = '/api/dungeon/mastery' as const;
export const DUNGEON_MASTERY_CURVE_VERSION = 'dungeon_mastery_curve_v1' as const;

export type DungeonMasteryRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface DungeonMasteryRankProgress {
  readonly complete: boolean;
  readonly currentRankThreshold: number;
  readonly nextRank: Exclude<DungeonMasteryRank, 0> | null;
  readonly nextRankThreshold: number | null;
  readonly progressIntoRank: number;
  readonly progressRequired: number;
  readonly remaining: number;
  readonly percent: number;
}

export interface DungeonMasteryLegacyProgress {
  readonly nextStar: number;
  readonly nextStarThreshold: number;
  readonly progressIntoInterval: number;
  readonly progressRequired: 250;
  readonly remaining: number;
  readonly percent: number;
}

export interface DungeonMasteryUnlock {
  readonly key: string;
  readonly grantingRank: Exclude<DungeonMasteryRank, 0>;
  readonly earned: true;
  readonly label: {
    readonly ar: string;
    readonly en: string;
  };
}

export interface DungeonMasteryRecentGrant {
  readonly createdAt: string;
  readonly progressDelta: number;
  readonly progressAfter: number;
  readonly rankAfter: DungeonMasteryRank;
  readonly legacyStarsAfter: number;
  readonly crossedRanks: readonly Exclude<DungeonMasteryRank, 0>[];
  readonly semanticUnlockKeys: readonly string[];
}

export interface DungeonMasteryOverview {
  readonly curveVersion: typeof DUNGEON_MASTERY_CURVE_VERSION;
  readonly progress: number;
  readonly rank: DungeonMasteryRank;
  readonly legacyStars: number;
  readonly rankProgress: DungeonMasteryRankProgress;
  readonly legacyProgress: DungeonMasteryLegacyProgress | null;
  readonly unlocks: readonly DungeonMasteryUnlock[];
  readonly recentGrants: readonly DungeonMasteryRecentGrant[];
}

export interface DungeonMasteryResponse {
  readonly ok: true;
  readonly mastery: DungeonMasteryOverview;
}

export type DungeonMasteryErrorCode =
  | 'NOT_FOUND'
  | 'MASTERY_UNAUTHENTICATED'
  | 'MASTERY_VALIDATION_ERROR'
  | 'MASTERY_METHOD_NOT_ALLOWED'
  | 'MASTERY_READ_UNAVAILABLE';

export type DungeonMasteryClientErrorCode =
  | DungeonMasteryErrorCode
  | 'DUNGEON_MASTERY_INVALID_RESPONSE'
  | 'DUNGEON_MASTERY_NETWORK_ERROR';

export type DungeonMasteryFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const RESPONSE_KEYS = ['ok', 'mastery'] as const;
const OVERVIEW_KEYS = [
  'curveVersion',
  'progress',
  'rank',
  'legacyStars',
  'rankProgress',
  'legacyProgress',
  'unlocks',
  'recentGrants',
] as const;
const RANK_PROGRESS_KEYS = [
  'complete',
  'currentRankThreshold',
  'nextRank',
  'nextRankThreshold',
  'progressIntoRank',
  'progressRequired',
  'remaining',
  'percent',
] as const;
const LEGACY_PROGRESS_KEYS = [
  'nextStar',
  'nextStarThreshold',
  'progressIntoInterval',
  'progressRequired',
  'remaining',
  'percent',
] as const;
const UNLOCK_KEYS = ['key', 'grantingRank', 'earned', 'label'] as const;
const LABEL_KEYS = ['ar', 'en'] as const;
const RECENT_GRANT_KEYS = [
  'createdAt',
  'progressDelta',
  'progressAfter',
  'rankAfter',
  'legacyStarsAfter',
  'crossedRanks',
  'semanticUnlockKeys',
] as const;
const CANONICAL_TIMESTAMP =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

export class DungeonMasteryContractError extends Error {
  override readonly name = 'DungeonMasteryContractError';
}

export class DungeonMasteryHttpError extends Error {
  override readonly name = 'DungeonMasteryHttpError';
  readonly status: number;
  readonly code: DungeonMasteryClientErrorCode;
  readonly retryable: boolean;

  constructor(status: number, code: DungeonMasteryClientErrorCode, retryable: boolean) {
    super('Dungeon Mastery request failed.');
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function contract(field: string): never {
  throw new DungeonMasteryContractError(`Invalid Dungeon Mastery contract at ${field}.`);
}

function strictRecord(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) contract(field);
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) contract(field);
  return source;
}

function safeInteger(value: unknown, field: string, options: { min?: number; max?: number } = {}): number {
  const min = options.min ?? 0;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) contract(field);
  return value;
}

function rank(value: unknown, field: string, allowZero = true): DungeonMasteryRank {
  return safeInteger(value, field, { min: allowZero ? 0 : 1, max: 10 }) as DungeonMasteryRank;
}

function strictText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || value.trim() !== value)
    contract(field);
  return value;
}

function canonicalTimestamp(value: unknown, field: string): string {
  const text = strictText(value, field);
  if (!CANONICAL_TIMESTAMP.test(text)) contract(field);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== text) contract(field);
  return text;
}

function normalizeRankProgress(value: unknown, masteryRank: DungeonMasteryRank): DungeonMasteryRankProgress {
  const source = strictRecord(value, RANK_PROGRESS_KEYS, 'rankProgress');
  if (typeof source.complete !== 'boolean') contract('rankProgress.complete');
  const complete = source.complete;
  const currentRankThreshold = safeInteger(source.currentRankThreshold, 'rankProgress.currentRankThreshold');
  const progressIntoRank = safeInteger(source.progressIntoRank, 'rankProgress.progressIntoRank');
  const progressRequired = safeInteger(source.progressRequired, 'rankProgress.progressRequired');
  const remaining = safeInteger(source.remaining, 'rankProgress.remaining');
  const percent = safeInteger(source.percent, 'rankProgress.percent', { max: 100 });
  let nextRank: Exclude<DungeonMasteryRank, 0> | null = null;
  let nextRankThreshold: number | null = null;

  if (complete) {
    if (
      masteryRank !== 10 ||
      source.nextRank !== null ||
      source.nextRankThreshold !== null ||
      progressIntoRank !== 0 ||
      progressRequired !== 0 ||
      remaining !== 0 ||
      percent !== 100
    ) {
      contract('rankProgress.complete');
    }
  } else {
    if (masteryRank === 10 || source.nextRank === null || source.nextRankThreshold === null) {
      contract('rankProgress.active');
    }
    nextRank = rank(source.nextRank, 'rankProgress.nextRank', false) as Exclude<DungeonMasteryRank, 0>;
    nextRankThreshold = safeInteger(source.nextRankThreshold, 'rankProgress.nextRankThreshold', { min: 1 });
    if (progressRequired < 1 || percent > 99) contract('rankProgress.active');
  }

  return Object.freeze({
    complete,
    currentRankThreshold,
    nextRank,
    nextRankThreshold,
    progressIntoRank,
    progressRequired,
    remaining,
    percent,
  });
}

function normalizeLegacyProgress(value: unknown, masteryRank: DungeonMasteryRank): DungeonMasteryLegacyProgress | null {
  if (value === null) {
    if (masteryRank === 10) contract('legacyProgress');
    return null;
  }
  if (masteryRank !== 10) contract('legacyProgress');
  const source = strictRecord(value, LEGACY_PROGRESS_KEYS, 'legacyProgress');
  const nextStar = safeInteger(source.nextStar, 'legacyProgress.nextStar', { min: 1 });
  const nextStarThreshold = safeInteger(source.nextStarThreshold, 'legacyProgress.nextStarThreshold', { min: 1 });
  const progressIntoInterval = safeInteger(source.progressIntoInterval, 'legacyProgress.progressIntoInterval');
  const progressRequired = safeInteger(source.progressRequired, 'legacyProgress.progressRequired');
  const remaining = safeInteger(source.remaining, 'legacyProgress.remaining', { min: 1 });
  const percent = safeInteger(source.percent, 'legacyProgress.percent', { max: 99 });
  if (progressRequired !== 250 || progressIntoInterval >= progressRequired || remaining > progressRequired) {
    contract('legacyProgress');
  }
  return Object.freeze({
    nextStar,
    nextStarThreshold,
    progressIntoInterval,
    progressRequired: 250 as const,
    remaining,
    percent,
  });
}

function normalizeUnlock(value: unknown, masteryRank: DungeonMasteryRank, index: number): DungeonMasteryUnlock {
  const source = strictRecord(value, UNLOCK_KEYS, `unlocks[${index}]`);
  const key = strictText(source.key, `unlocks[${index}].key`);
  const grantingRank = rank(source.grantingRank, `unlocks[${index}].grantingRank`, false) as Exclude<
    DungeonMasteryRank,
    0
  >;
  if (grantingRank > masteryRank || source.earned !== true) contract(`unlocks[${index}]`);
  const labelSource = strictRecord(source.label, LABEL_KEYS, `unlocks[${index}].label`);
  const label = Object.freeze({
    ar: strictText(labelSource.ar, `unlocks[${index}].label.ar`),
    en: strictText(labelSource.en, `unlocks[${index}].label.en`),
  });
  return Object.freeze({ key, grantingRank, earned: true as const, label });
}

function normalizeRankArray(value: unknown, field: string): readonly Exclude<DungeonMasteryRank, 0>[] {
  if (!Array.isArray(value) || value.length > 10) contract(field);
  const ranks = value.map((entry, index) => rank(entry, `${field}[${index}]`, false) as Exclude<DungeonMasteryRank, 0>);
  if (ranks.some((entry, index) => index > 0 && ranks[index - 1]! >= entry)) contract(field);
  return Object.freeze(ranks);
}

function normalizeKeyArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 13) contract(field);
  const keys = value.map((entry, index) => strictText(entry, `${field}[${index}]`));
  if (new Set(keys).size !== keys.length) contract(field);
  return Object.freeze(keys);
}

function normalizeRecentGrant(value: unknown, index: number): DungeonMasteryRecentGrant {
  const field = `recentGrants[${index}]`;
  const source = strictRecord(value, RECENT_GRANT_KEYS, field);
  return Object.freeze({
    createdAt: canonicalTimestamp(source.createdAt, `${field}.createdAt`),
    progressDelta: safeInteger(source.progressDelta, `${field}.progressDelta`, { min: 1 }),
    progressAfter: safeInteger(source.progressAfter, `${field}.progressAfter`),
    rankAfter: rank(source.rankAfter, `${field}.rankAfter`),
    legacyStarsAfter: safeInteger(source.legacyStarsAfter, `${field}.legacyStarsAfter`),
    crossedRanks: normalizeRankArray(source.crossedRanks, `${field}.crossedRanks`),
    semanticUnlockKeys: normalizeKeyArray(source.semanticUnlockKeys, `${field}.semanticUnlockKeys`),
  });
}

export function normalizeDungeonMasteryResponse(value: unknown): DungeonMasteryResponse {
  const response = strictRecord(value, RESPONSE_KEYS, 'response');
  if (response.ok !== true) contract('response.ok');
  const source = strictRecord(response.mastery, OVERVIEW_KEYS, 'mastery');
  if (source.curveVersion !== DUNGEON_MASTERY_CURVE_VERSION) contract('mastery.curveVersion');
  const progress = safeInteger(source.progress, 'mastery.progress');
  const masteryRank = rank(source.rank, 'mastery.rank');
  const legacyStars = safeInteger(source.legacyStars, 'mastery.legacyStars');
  const rankProgress = normalizeRankProgress(source.rankProgress, masteryRank);
  const legacyProgress = normalizeLegacyProgress(source.legacyProgress, masteryRank);
  if (!Array.isArray(source.unlocks) || source.unlocks.length > 13) contract('mastery.unlocks');
  const unlocks = source.unlocks.map((entry, index) => normalizeUnlock(entry, masteryRank, index));
  if (new Set(unlocks.map((entry) => entry.key)).size !== unlocks.length) contract('mastery.unlocks');
  if (!Array.isArray(source.recentGrants) || source.recentGrants.length > 10) contract('mastery.recentGrants');
  const recentGrants = source.recentGrants.map(normalizeRecentGrant);
  const unlockKeys = new Set(unlocks.map((entry) => entry.key));
  if (recentGrants.some((grant) => grant.semanticUnlockKeys.some((key) => !unlockKeys.has(key)))) {
    contract('mastery.recentGrants.semanticUnlockKeys');
  }

  const mastery = Object.freeze({
    curveVersion: DUNGEON_MASTERY_CURVE_VERSION,
    progress,
    rank: masteryRank,
    legacyStars,
    rankProgress,
    legacyProgress,
    unlocks: Object.freeze(unlocks),
    recentGrants: Object.freeze(recentGrants),
  });
  return Object.freeze({ ok: true as const, mastery });
}

function backendErrorCode(payload: unknown): DungeonMasteryErrorCode | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || !('ok' in source) || !('error' in source) || source.ok !== false) return null;
  if (!source.error || typeof source.error !== 'object' || Array.isArray(source.error)) return null;
  const error = source.error as Record<string, unknown>;
  if (Object.keys(error).length !== 2 || !('code' in error) || !('message' in error)) return null;
  if (typeof error.message !== 'string' || error.message.length < 1 || error.message.length > 500) return null;
  const code = error.code;
  return code === 'NOT_FOUND' ||
    code === 'MASTERY_UNAUTHENTICATED' ||
    code === 'MASTERY_VALIDATION_ERROR' ||
    code === 'MASTERY_METHOD_NOT_ALLOWED' ||
    code === 'MASTERY_READ_UNAVAILABLE'
    ? code
    : null;
}

function statusError(status: number, payload: unknown): DungeonMasteryHttpError {
  const code = backendErrorCode(payload);
  if (status === 404 && code === 'NOT_FOUND') return new DungeonMasteryHttpError(status, code, false);
  if (status === 401 && code === 'MASTERY_UNAUTHENTICATED') return new DungeonMasteryHttpError(status, code, false);
  if (status === 400 && code === 'MASTERY_VALIDATION_ERROR') return new DungeonMasteryHttpError(status, code, false);
  if (status === 405 && code === 'MASTERY_METHOD_NOT_ALLOWED') return new DungeonMasteryHttpError(status, code, false);
  if (status >= 500 && code === 'MASTERY_READ_UNAVAILABLE') return new DungeonMasteryHttpError(status, code, true);
  return new DungeonMasteryHttpError(status, 'DUNGEON_MASTERY_INVALID_RESPONSE', true);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class DungeonMasteryApi {
  private readonly baseUrl: string;
  private readonly fetcher: DungeonMasteryFetch;

  constructor(baseUrl = 'https://api.tnx6.xyz', fetcher: DungeonMasteryFetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetcher = fetcher;
  }

  async getOverview(signal?: AbortSignal): Promise<DungeonMasteryOverview> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${DUNGEON_MASTERY_ROUTE}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new DungeonMasteryHttpError(0, 'DUNGEON_MASTERY_NETWORK_ERROR', true);
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw statusError(response.status, null);
      throw new DungeonMasteryHttpError(response.status, 'DUNGEON_MASTERY_INVALID_RESPONSE', true);
    }
    if (!response.ok) throw statusError(response.status, payload);
    try {
      return normalizeDungeonMasteryResponse(payload).mastery;
    } catch (error) {
      if (error instanceof DungeonMasteryContractError) {
        throw new DungeonMasteryHttpError(response.status, 'DUNGEON_MASTERY_INVALID_RESPONSE', true);
      }
      throw error;
    }
  }
}

export function isDungeonMasteryUnauthenticated(error: unknown): boolean {
  return error instanceof DungeonMasteryHttpError && error.code === 'MASTERY_UNAUTHENTICATED';
}

export function isDungeonMasteryFeatureUnavailable(error: unknown): boolean {
  return error instanceof DungeonMasteryHttpError && error.code === 'NOT_FOUND';
}

export function isDungeonMasteryRetryable(error: unknown): boolean {
  return error instanceof DungeonMasteryHttpError && error.retryable;
}

export function dungeonMasteryErrorMessage(error: unknown): string {
  if (isDungeonMasteryUnauthenticated(error)) return 'سجّل الدخول عبر Twitch لعرض تقدم الإتقان.';
  if (
    error instanceof DungeonMasteryHttpError &&
    (error.code === 'MASTERY_VALIDATION_ERROR' || error.code === 'MASTERY_METHOD_NOT_ALLOWED')
  ) {
    return 'تعذر التحقق من طلب الإتقان.';
  }
  return 'تعذر تحميل بيانات الإتقان حالياً. حاول مرة أخرى.';
}
