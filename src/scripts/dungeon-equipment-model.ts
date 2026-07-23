export const DUNGEON_EQUIPMENT_SLOTS = ['weapon', 'helmet', 'armor', 'boots'] as const;
export const DUNGEON_EQUIPMENT_STATS = ['attack', 'defense', 'health', 'dodge'] as const;

export type DungeonEquipmentSlot = (typeof DUNGEON_EQUIPMENT_SLOTS)[number];
export type DungeonEquipmentStat = (typeof DUNGEON_EQUIPMENT_STATS)[number];
export type DungeonEquipmentMutationKind = 'equip' | 'unequip';

export interface DungeonEquipmentBonuses {
  attack: number;
  defense: number;
  health: number;
  dodge: number;
}

export interface DungeonEquipmentItem {
  itemKey: string;
  itemName: string;
  slot: DungeonEquipmentSlot;
  rarity: string;
  bonuses: DungeonEquipmentBonuses;
}

export interface DungeonEquipmentOwnedItem extends DungeonEquipmentItem {
  ownedQuantity: number;
  equipped: boolean;
  equippedRequiredQuantity: 0 | 1;
  unequippedAvailableQuantity: number;
}

export type DungeonEquipmentLoadoutSlots = Record<DungeonEquipmentSlot, DungeonEquipmentItem | null>;

export interface DungeonEquipmentLoadout {
  loadoutVersion: number;
  slots: DungeonEquipmentLoadoutSlots;
  totalBonuses: DungeonEquipmentBonuses;
}

export interface DungeonEquipmentInventory {
  items: DungeonEquipmentOwnedItem[];
}

export type DungeonEquipmentMutationOutcome =
  | 'equipped'
  | 'replaced'
  | 'already_equipped'
  | 'unequipped'
  | 'already_unequipped';

export interface DungeonEquipmentMutationResult extends DungeonEquipmentLoadout {
  ok: true;
  outcome: DungeonEquipmentMutationOutcome;
  replayed: boolean;
  changedSlot: DungeonEquipmentSlot;
}

export interface DungeonEquipmentComparisonRow {
  stat: DungeonEquipmentStat;
  current: number;
  selected: number;
  difference: number;
}

export interface DungeonEquipmentMutationOperation {
  kind: DungeonEquipmentMutationKind;
  requestId: string;
  slot: DungeonEquipmentSlot;
  item: DungeonEquipmentOwnedItem | null;
}

export type DungeonEquipmentFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface DungeonEquipmentReadApi {
  getLoadout(signal?: AbortSignal): Promise<DungeonEquipmentLoadout>;
  getInventory(signal?: AbortSignal): Promise<DungeonEquipmentInventory>;
}

export interface DungeonEquipmentData {
  loadout: DungeonEquipmentLoadout;
  inventory: DungeonEquipmentInventory;
}

const ITEM_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MUTATION_OUTCOMES = new Set<DungeonEquipmentMutationOutcome>([
  'equipped',
  'replaced',
  'already_equipped',
  'unequipped',
  'already_unequipped',
]);

export const EMPTY_EQUIPMENT_BONUSES: Readonly<DungeonEquipmentBonuses> = Object.freeze({
  attack: 0,
  defense: 0,
  health: 0,
  dodge: 0,
});

export const SLOT_LABELS: Readonly<Record<DungeonEquipmentSlot, string>> = Object.freeze({
  weapon: 'السلاح',
  helmet: 'الخوذة',
  armor: 'الدرع',
  boots: 'الحذاء',
});

export const SLOT_FILTER_LABELS: Readonly<Record<DungeonEquipmentSlot, string>> = Object.freeze({
  weapon: 'الأسلحة',
  helmet: 'الخوذ',
  armor: 'الدروع',
  boots: 'الأحذية',
});

export const STAT_LABELS: Readonly<Record<DungeonEquipmentStat, string>> = Object.freeze({
  attack: 'الهجوم',
  defense: 'الدفاع',
  health: 'الصحة',
  dodge: 'التفادي',
});

export const RARITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  common: 'عادي',
  rare: 'نادر',
  epic: 'ملحمي',
  legendary: 'أسطوري',
});

export const OUTCOME_MESSAGES: Readonly<Record<DungeonEquipmentMutationOutcome, string>> = Object.freeze({
  equipped: 'تم تجهيز القطعة.',
  replaced: 'تم استبدال القطعة المجهزة.',
  already_equipped: 'هذه القطعة مجهزة بالفعل.',
  unequipped: 'تم فك تجهيز القطعة.',
  already_unequipped: 'الخانة فارغة بالفعل.',
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function safeInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : fallback;
}

export function isDungeonEquipmentSlot(value: unknown): value is DungeonEquipmentSlot {
  return typeof value === 'string' && DUNGEON_EQUIPMENT_SLOTS.includes(value as DungeonEquipmentSlot);
}

export function normalizeEquipmentBonuses(value: unknown): DungeonEquipmentBonuses {
  const source = record(value);
  return {
    attack: safeInteger(source?.attack),
    defense: safeInteger(source?.defense),
    health: safeInteger(source?.health),
    dodge: safeInteger(source?.dodge),
  };
}

function normalizeItem(value: unknown, requiredSlot?: DungeonEquipmentSlot): DungeonEquipmentItem | null {
  const source = record(value);
  if (!source) return null;

  const itemKey = boundedText(source.itemKey, '', 256);
  const slot = requiredSlot || source.slot;
  if (!ITEM_KEY_PATTERN.test(itemKey) || !isDungeonEquipmentSlot(slot)) return null;

  return {
    itemKey,
    itemName: boundedText(source.itemName, 'قطعة غير معروفة', 120),
    slot,
    rarity: boundedText(source.rarity, 'unknown', 48).toLowerCase(),
    bonuses: normalizeEquipmentBonuses(source.bonuses),
  };
}

export function normalizeDungeonEquipmentLoadout(value: unknown): DungeonEquipmentLoadout {
  const source = record(value);
  const sourceSlots = record(source?.slots);
  const slots = {} as DungeonEquipmentLoadoutSlots;

  for (const slot of DUNGEON_EQUIPMENT_SLOTS) {
    slots[slot] = normalizeItem(sourceSlots?.[slot], slot);
  }

  return {
    loadoutVersion: safeInteger(source?.loadoutVersion),
    slots,
    totalBonuses: normalizeEquipmentBonuses(source?.totalBonuses),
  };
}

export function normalizeDungeonEquipmentInventory(value: unknown): DungeonEquipmentInventory {
  const source = record(value);
  const sourceItems = Array.isArray(source?.items) ? source.items : [];
  const items: DungeonEquipmentOwnedItem[] = [];
  const seen = new Set<string>();

  for (const candidate of sourceItems) {
    const itemSource = record(candidate);
    const item = normalizeItem(candidate);
    if (!item || !itemSource) continue;

    const identity = `${item.slot}:${item.itemKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const equippedRequiredQuantity = itemSource.equippedRequiredQuantity === 1 ? 1 : 0;
    items.push({
      ...item,
      ownedQuantity: safeInteger(itemSource.ownedQuantity),
      equipped: itemSource.equipped === true,
      equippedRequiredQuantity,
      unequippedAvailableQuantity: safeInteger(itemSource.unequippedAvailableQuantity),
    });
  }

  return { items };
}

export function filterDungeonEquipmentItems(
  items: readonly DungeonEquipmentOwnedItem[],
  slot: DungeonEquipmentSlot | 'all'
): DungeonEquipmentOwnedItem[] {
  return slot === 'all' ? [...items] : items.filter((item) => item.slot === slot);
}

export function compareDungeonEquipment(
  current: DungeonEquipmentItem | null,
  selected: DungeonEquipmentItem
): DungeonEquipmentComparisonRow[] {
  return DUNGEON_EQUIPMENT_STATS.map((stat) => {
    const currentValue = current?.bonuses[stat] || 0;
    const selectedValue = selected.bonuses[stat];
    return {
      stat,
      current: currentValue,
      selected: selectedValue,
      difference: selectedValue - currentValue,
    };
  });
}

export function createDungeonEquipmentRequestId(cryptoSource: Crypto = crypto): string {
  if (typeof cryptoSource.randomUUID === 'function') return cryptoSource.randomUUID();

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
    .slice(8, 10)
    .join('')}-${hex.slice(10).join('')}`;
}

export function createDungeonEquipmentOperation(
  kind: DungeonEquipmentMutationKind,
  slot: DungeonEquipmentSlot,
  item: DungeonEquipmentOwnedItem | null,
  requestIdFactory: () => string = () => createDungeonEquipmentRequestId()
): DungeonEquipmentMutationOperation {
  if (kind === 'equip' && (!item || item.slot !== slot)) throw new Error('Invalid equipment operation.');
  return { kind, slot, item, requestId: requestIdFactory() };
}

export function buildDungeonEquipmentMutationBody(
  operation: DungeonEquipmentMutationOperation
): Record<string, string> {
  if (operation.kind === 'equip') {
    if (!operation.item || operation.item.slot !== operation.slot) throw new Error('Invalid equipment operation.');
    return {
      requestId: operation.requestId,
      slot: operation.slot,
      itemKey: operation.item.itemKey,
    };
  }

  return { requestId: operation.requestId, slot: operation.slot };
}

export class DungeonEquipmentHttpError extends Error {
  override readonly name = 'DungeonEquipmentHttpError';
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const type = response.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('application/json')) return null;
  return response.json().catch(() => null);
}

function responseError(response: Response, payload: unknown): DungeonEquipmentHttpError {
  const source = record(payload);
  const error = record(source?.error);
  return new DungeonEquipmentHttpError(
    response.status,
    boundedText(error?.code, 'DUNGEON_EQUIPMENT_UNKNOWN_ERROR', 96),
    boundedText(error?.message, 'تعذر تنفيذ الطلب.', 240)
  );
}

export class DungeonEquipmentApi {
  private readonly baseUrl: string;
  private readonly fetcher: DungeonEquipmentFetch;

  constructor(baseUrl: string, fetcher: DungeonEquipmentFetch = fetch) {
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) throw responseError(response, payload);
    return payload;
  }

  async getLoadout(signal?: AbortSignal): Promise<DungeonEquipmentLoadout> {
    const payload = await this.request('/api/dungeon/equipment/loadout', { method: 'GET' }, signal);
    return normalizeDungeonEquipmentLoadout(payload);
  }

  async getInventory(signal?: AbortSignal): Promise<DungeonEquipmentInventory> {
    const payload = await this.request('/api/dungeon/equipment/inventory', { method: 'GET' }, signal);
    return normalizeDungeonEquipmentInventory(payload);
  }

  async mutate(
    operation: DungeonEquipmentMutationOperation,
    signal?: AbortSignal
  ): Promise<DungeonEquipmentMutationResult> {
    const payload = await this.request(
      `/api/dungeon/equipment/${operation.kind}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDungeonEquipmentMutationBody(operation)),
      },
      signal
    );
    const source = record(payload);
    if (!source || source.ok !== true || !MUTATION_OUTCOMES.has(source.outcome as DungeonEquipmentMutationOutcome)) {
      throw new DungeonEquipmentHttpError(500, 'DUNGEON_EQUIPMENT_INVALID_RESPONSE', 'تعذر التحقق من نتيجة العملية.');
    }
    const loadout = normalizeDungeonEquipmentLoadout(source);
    const changedSlot = isDungeonEquipmentSlot(source.changedSlot) ? source.changedSlot : operation.slot;
    return {
      ...loadout,
      ok: true,
      outcome: source.outcome as DungeonEquipmentMutationOutcome,
      replayed: source.replayed === true,
      changedSlot,
    };
  }
}

export async function loadDungeonEquipmentData(
  api: DungeonEquipmentReadApi,
  signal?: AbortSignal
): Promise<DungeonEquipmentData> {
  const loadout = await api.getLoadout(signal);
  const inventory = await api.getInventory(signal);
  return { loadout, inventory };
}

export function equipmentErrorMessage(error: unknown, phase: 'load' | 'mutation'): string {
  if (!(error instanceof DungeonEquipmentHttpError)) {
    return phase === 'load' ? 'تعذر تحميل المعدات.' : 'تعذر الاتصال. لم تتغير معداتك.';
  }

  if (error.status === 400) return 'بيانات الطلب غير صالحة.';
  if (error.status === 401) return 'انتهت جلسة تسجيل الدخول. سجل الدخول مرة أخرى.';
  if (error.status === 404 && phase === 'mutation') return 'القطعة لم تعد متاحة.';
  if (error.status === 429) return 'عدد محاولات كبير. انتظر قليلًا ثم حاول مرة أخرى.';
  if (error.code === 'DUNGEON_EQUIPMENT_NOT_OWNED' || error.code === 'DUNGEON_EQUIPMENT_ITEM_DISABLED') {
    return 'أنت لا تملك هذه القطعة أو لم تعد متاحة.';
  }
  if (error.code === 'DUNGEON_EQUIPMENT_SLOT_MISMATCH') return 'القطعة لا تناسب هذه الخانة.';
  if (error.code === 'DUNGEON_EQUIPMENT_IDEMPOTENCY_CONFLICT') {
    return 'تعذر تأكيد العملية. حدّث المعدات وحاول من جديد.';
  }
  if (error.code === 'DUNGEON_EQUIPMENT_CONCURRENCY_CONFLICT') {
    return 'تغيرت معداتك من جلسة أخرى. يتم تحديث البيانات.';
  }
  return phase === 'load' ? 'تعذر تحميل المعدات.' : 'حدث خطأ غير متوقع. لم تتغير معداتك.';
}

export function isDungeonEquipmentConcurrencyError(error: unknown): boolean {
  return error instanceof DungeonEquipmentHttpError && error.code === 'DUNGEON_EQUIPMENT_CONCURRENCY_CONFLICT';
}

export function isDungeonEquipmentUnauthenticated(error: unknown): boolean {
  return error instanceof DungeonEquipmentHttpError && error.status === 401;
}

export function isDungeonEquipmentFeatureUnavailable(error: unknown): boolean {
  return error instanceof DungeonEquipmentHttpError && error.status === 404;
}
