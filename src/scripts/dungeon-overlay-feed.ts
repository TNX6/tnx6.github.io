import type {
  DungeonViewerEvent,
  DungeonViewerRunParticipant,
  DungeonViewerRunSummary,
} from './dungeon-overlay-viewer';

export const DUNGEON_EVENT_FEED_LIMIT = 4;

export type DungeonEventFeedTone = 'normal' | 'danger' | 'mystery' | 'success' | 'reward' | 'death';
export type DungeonEventFeedIcon = 'entrance' | 'trap' | 'encounter' | 'treasure' | 'boss';

export interface DungeonEventFeedItem {
  id: string;
  icon: DungeonEventFeedIcon;
  text: string;
  tone: DungeonEventFeedTone;
  playerSlots: number[];
  playerName?: string;
  actionText?: string;
  isolatedText?: string;
  trailingText?: string;
}

export interface DungeonEventFeedAppendResult {
  added: boolean;
  removed: DungeonEventFeedItem | null;
}

export interface DungeonTerminalRewardRow {
  key: string;
  displayName: string;
  status: 'نجا' | 'مات' | null;
  xpText: string | null;
  materials: string[];
}

export interface DungeonTerminalPresentation {
  survivors: number;
  deaths: number;
  description: string;
  rows: DungeonTerminalRewardRow[];
  rewardEvents: DungeonEventFeedItem[];
}

function formatFeedXp(value: number): string {
  return `+${value} XP`;
}

function normalizeFeedText(value: string): string {
  return value
    .replaceAll('غنائم مخطط لها', 'غنائم داخل الدنجن')
    .replaceAll('فشلت الرحلة قبل تحقيق هدفها', 'لم يتمكن الفريق من إكمال الرحلة')
    .replace(/reward planned/giu, 'مكافأة داخل الدنجن')
    .replace(/planned loot/giu, 'غنائم داخل الدنجن')
    .replace(/demo reward/giu, 'مكافأة')
    .replace(/placeholder/giu, 'حدث داخل الدنجن');
}

export class DungeonEventFeedStore {
  readonly #limit: number;
  readonly #seenIds = new Set<string>();
  #items: DungeonEventFeedItem[] = [];

  constructor(limit = DUNGEON_EVENT_FEED_LIMIT) {
    this.#limit = limit;
  }

  append(item: DungeonEventFeedItem): DungeonEventFeedAppendResult {
    if (this.#seenIds.has(item.id)) return { added: false, removed: null };
    this.#seenIds.add(item.id);
    this.#items.push(item);
    const removed = this.#items.length > this.#limit ? (this.#items.shift() ?? null) : null;
    return { added: true, removed };
  }

  hydrate(items: DungeonEventFeedItem[]): DungeonEventFeedItem[] {
    this.reset();
    items.forEach((item) => this.append(item));
    return this.values();
  }

  forget(itemId: string): void {
    this.#seenIds.delete(itemId);
    this.#items = this.#items.filter((item) => item.id !== itemId);
  }

  reset(): void {
    this.#seenIds.clear();
    this.#items = [];
  }

  values(): DungeonEventFeedItem[] {
    return [...this.#items];
  }
}

function includesPlayerName(text: string, participants: DungeonViewerEvent['players']): boolean {
  return participants.some((participant) => text.includes(participant.displayName));
}

function viewerEventTone(event: DungeonViewerEvent, text: string): DungeonEventFeedTone {
  if (/\b(?:dead|death|killed)\b/i.test(event.outcome) || /(?:مات|وفاة|قُتل|قتل)/u.test(text)) return 'death';
  if (event.severity === 'danger' || event.stage === 'trap' || event.stage === 'boss') return 'danger';
  if (event.severity === 'success') return 'success';
  if (event.stage === 'treasure') return 'mystery';
  return 'normal';
}

export function dungeonViewerEventFeedId(runId: string, sequenceNumber: number): string {
  return `event:${runId}:${sequenceNumber}`;
}

export function dungeonViewerEventToFeedItem(runId: string, event: DungeonViewerEvent): DungeonEventFeedItem {
  const title = normalizeFeedText(event.title);
  const message = normalizeFeedText(event.message);
  const eventText = message === title ? title : `${title}: ${message}`;
  const text =
    event.players.length === 1 && !includesPlayerName(eventText, event.players)
      ? `${event.players[0].displayName}: ${eventText}`
      : eventText;
  const icon: DungeonEventFeedIcon =
    event.stage === 'result' ? (event.outcome === 'failed' ? 'boss' : 'treasure') : event.stage;

  return {
    id: dungeonViewerEventFeedId(runId, event.sequenceNumber),
    icon,
    text,
    tone: viewerEventTone(event, text),
    playerSlots: event.players.map((player) => player.slotNumber),
  };
}

function participantRewardKey(
  summary: DungeonViewerRunSummary,
  displayName: string,
  rewardIndex: number
): { key: string; participant: DungeonViewerRunParticipant | null } {
  const occurrence = summary.rewards
    .slice(0, rewardIndex)
    .filter((reward) => reward.displayName === displayName).length;
  const participant =
    summary.participants.filter((candidate) => candidate.displayName === displayName)[occurrence] ?? null;
  return {
    key: participant ? `slot:${participant.slotNumber}` : `name:${displayName}:${occurrence}`,
    participant,
  };
}

export function buildDungeonRewardFeedItems(summary: DungeonViewerRunSummary): DungeonEventFeedItem[] {
  const items: DungeonEventFeedItem[] = [];

  summary.rewards.forEach((reward, rewardIndex) => {
    const identity = participantRewardKey(summary, reward.displayName, rewardIndex);
    const playerSlots = identity.participant ? [identity.participant.slotNumber] : [];
    if (reward.xp > 0) {
      items.push({
        id: `reward:${summary.id}:${identity.key}:xp:${reward.xp}`,
        icon: 'treasure',
        text: `${reward.displayName} حصل على ${formatFeedXp(reward.xp)}`,
        playerName: reward.displayName,
        actionText: 'حصل على',
        isolatedText: formatFeedXp(reward.xp),
        tone: 'reward',
        playerSlots,
      });
    }
    reward.materials.forEach((material, materialIndex) => {
      items.push({
        id: `reward:${summary.id}:${identity.key}:material:${material.itemName}:${materialIndex}`,
        icon: 'treasure',
        text: `${reward.displayName} حصل على ${material.itemName} ×${material.quantity}.`,
        tone: 'reward',
        playerSlots,
      });
    });
  });

  return items;
}

function rewardsByParticipant(
  summary: DungeonViewerRunSummary
): Map<number, DungeonViewerRunSummary['rewards'][number]> {
  const assignments = new Map<number, DungeonViewerRunSummary['rewards'][number]>();
  const usedRewardIndexes = new Set<number>();

  summary.participants.forEach((participant) => {
    const rewardIndex = summary.rewards.findIndex(
      (reward, index) => !usedRewardIndexes.has(index) && reward.displayName === participant.displayName
    );
    if (rewardIndex < 0) return;
    usedRewardIndexes.add(rewardIndex);
    assignments.set(participant.slotNumber, summary.rewards[rewardIndex]);
  });

  return assignments;
}

export function buildDungeonTerminalPresentation(summary: DungeonViewerRunSummary): DungeonTerminalPresentation {
  const survivors = summary.participants.filter((participant) => participant.survived === true).length;
  const deaths = summary.participants.filter((participant) => participant.survived === false).length;
  const playerLabel = summary.participants.length === 1 ? 'لاعب' : 'لاعبين';
  const rewardAssignments = rewardsByParticipant(summary);
  const rows = summary.participants
    .slice()
    .sort((left, right) => left.slotNumber - right.slotNumber)
    .slice(0, 6)
    .map((participant) => {
      const reward = rewardAssignments.get(participant.slotNumber);
      return {
        key: `slot:${participant.slotNumber}`,
        displayName: participant.displayName,
        status:
          participant.survived === true ? ('نجا' as const) : participant.survived === false ? ('مات' as const) : null,
        xpText: reward && reward.xp > 0 ? formatFeedXp(reward.xp) : null,
        materials: reward?.materials.map((material) => `${material.itemName} ×${material.quantity}`) ?? [],
      };
    });

  return {
    survivors,
    deaths,
    description: `نجا ${survivors} من أصل ${summary.participants.length} ${playerLabel}، ومات ${deaths}.`,
    rows,
    rewardEvents: buildDungeonRewardFeedItems(summary),
  };
}
