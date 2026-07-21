export const DUNGEON_TERMINAL_FADE_MS = 400;

interface TerminalFadeClassList {
  add(token: string): void;
  remove(token: string): void;
}

interface TerminalFadeTarget {
  classList: TerminalFadeClassList;
}

export type DungeonPresentationScheduler = (delayMs: number, callback: () => void) => void;

export function formatDungeonXp(value: number): string {
  return `+${value} XP`;
}

export function normalizeDungeonViewerText(value: string): string {
  return value
    .replaceAll('غنائم مخطط لها', 'غنائم داخل الدنجن')
    .replaceAll('فشلت الرحلة قبل تحقيق هدفها', 'لم يتمكن الفريق من إكمال الرحلة')
    .replace(/reward planned/giu, 'مكافأة داخل الدنجن')
    .replace(/planned loot/giu, 'غنائم داخل الدنجن')
    .replace(/demo reward/giu, 'مكافأة')
    .replace(/placeholder/giu, 'حدث داخل الدنجن');
}

export function dungeonTerminalDescription(failed: boolean, survivors: number): string {
  if (failed) return 'لم يتمكن الفريق من إكمال الدنجن.';
  return survivors > 0 ? 'عثر الناجون على غنائم داخل الدنجن.' : 'اكتملت الرحلة.';
}

export function beginDungeonTerminalFade(
  target: TerminalFadeTarget,
  schedule: DungeonPresentationScheduler,
  onComplete: () => void,
  durationMs = DUNGEON_TERMINAL_FADE_MS
): () => void {
  let active = true;
  target.classList.add('dov-overlay--leaving');
  schedule(durationMs, () => {
    if (!active) return;
    active = false;
    onComplete();
  });
  return () => {
    if (!active) return;
    active = false;
    target.classList.remove('dov-overlay--leaving');
  };
}
