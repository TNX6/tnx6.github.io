export type DungeonLifecycleNudgeResult =
  | 'events_persisted'
  | 'terminal_replay'
  | 'actively_processing'
  | 'not_due'
  | 'run_not_active';

export type DungeonLifecycleNudgeRunStatus = 'joining' | 'running' | 'completed' | 'failed';

export interface DungeonLifecycleNudgeOutcome {
  result: DungeonLifecycleNudgeResult;
  statusAfter: DungeonLifecycleNudgeRunStatus | null;
  eventsPersisted: number;
}

export type DungeonLifecycleNudgeClientAction = 'complete' | 'retry' | 'stop';

export const DUNGEON_NUDGE_RETRY_MS = 750;
export const DUNGEON_NUDGE_MAX_ATTEMPTS = 8;
export const DUNGEON_NUDGE_RETRY_WINDOW_MS = 10_000;

export function dungeonLifecycleNudgeClientAction(
  response: DungeonLifecycleNudgeOutcome
): DungeonLifecycleNudgeClientAction {
  if (
    response.eventsPersisted > 0 ||
    response.statusAfter === 'completed' ||
    response.statusAfter === 'failed' ||
    response.result === 'terminal_replay'
  ) {
    return 'complete';
  }
  return response.result === 'actively_processing' ? 'retry' : 'stop';
}

export function isRetryableDungeonLifecycleNudgeStatus(status: number | null): boolean {
  return status === null || status === 409 || status === 423;
}

export function canRetryDungeonLifecycleNudge(attempts: number, elapsedMs: number): boolean {
  return attempts < DUNGEON_NUDGE_MAX_ATTEMPTS && elapsedMs >= 0 && elapsedMs < DUNGEON_NUDGE_RETRY_WINDOW_MS;
}
