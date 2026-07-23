import {
  DUNGEON_EQUIPMENT_SLOTS,
  DUNGEON_EQUIPMENT_STATS,
  DungeonEquipmentApi,
  DungeonEquipmentHttpError,
  OUTCOME_MESSAGES,
  RARITY_LABELS,
  SLOT_FILTER_LABELS,
  SLOT_LABELS,
  STAT_LABELS,
  compareDungeonEquipment,
  createDungeonEquipmentOperation,
  equipmentErrorMessage,
  filterDungeonEquipmentItems,
  isDungeonEquipmentConcurrencyError,
  isDungeonEquipmentFeatureUnavailable,
  isDungeonEquipmentUnauthenticated,
  loadDungeonEquipmentData,
  type DungeonEquipmentBonuses,
  type DungeonEquipmentInventory,
  type DungeonEquipmentItem,
  type DungeonEquipmentLoadout,
  type DungeonEquipmentMutationOperation,
  type DungeonEquipmentMutationOutcome,
  type DungeonEquipmentMutationResult,
  type DungeonEquipmentOwnedItem,
  type DungeonEquipmentSlot,
} from './dungeon-equipment-model';

interface DungeonEquipmentApiContract {
  getLoadout(signal?: AbortSignal): Promise<DungeonEquipmentLoadout>;
  getInventory(signal?: AbortSignal): Promise<DungeonEquipmentInventory>;
  mutate(operation: DungeonEquipmentMutationOperation, signal?: AbortSignal): Promise<DungeonEquipmentMutationResult>;
}

interface PanelElements {
  root: HTMLElement;
  loading: HTMLElement;
  login: HTMLElement;
  body: HTMLElement;
  error: HTMLElement;
  errorMessage: HTMLElement;
  loadRetry: HTMLButtonElement;
  refresh: HTMLButtonElement;
  announcer: HTMLElement;
  bonuses: HTMLElement;
  slots: HTMLElement;
  inventory: HTMLElement;
  inventoryCount: HTMLElement;
  ownedSection: HTMLElement;
  comparison: HTMLElement;
  comparisonContent: HTMLElement;
  closeComparison: HTMLButtonElement;
  mutationFeedback: HTMLElement;
  mutationMessage: HTMLElement;
  mutationRetry: HTMLButtonElement;
  filters: HTMLButtonElement[];
}

type EquipmentFilter = DungeonEquipmentSlot | 'all';

interface PanelState {
  initialized: boolean;
  destroyed: boolean;
  featureUnavailable: boolean;
  loading: boolean;
  mutating: boolean;
  loadout: DungeonEquipmentLoadout | null;
  inventory: DungeonEquipmentOwnedItem[];
  filter: EquipmentFilter;
  selectedItem: DungeonEquipmentOwnedItem | null;
  pendingOperation: DungeonEquipmentMutationOperation | null;
  loadController: AbortController | null;
  mutationController: AbortController | null;
  loadPromise: Promise<boolean> | null;
  slotButtons: Map<DungeonEquipmentSlot, HTMLButtonElement>;
  itemButtons: Map<DungeonEquipmentOwnedItem, HTMLButtonElement>;
}

const activePanels = new Set<DungeonEquipmentPanelController>();
const installedRoots = new WeakSet<HTMLElement>();
let lifecycleInstalled = false;

const SLOT_ICON_PATHS: Readonly<Record<DungeonEquipmentSlot, readonly string[]>> = Object.freeze({
  weapon: ['M14.5 5.5 18.5 1.5 22 2l.5 3.5-4 4', 'm13 7 4 4', 'M3 21l7.5-7.5', 'm5 16 3 3'],
  helmet: ['M5 18v-7a7 7 0 0 1 14 0v7', 'M5 13h14', 'M12 4v9', 'M9 18v-5M15 18v-5'],
  armor: ['m8 4 4-2 4 2 4 2-2 5v10l-6 3-6-3V11L4 6l4-2Z', 'M8 4v7h8V4'],
  boots: ['M8 3h7v9l4 3v4H7a3 3 0 0 1-3-3v-2h4V3Z', 'M8 10h7'],
});

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing equipment panel element: ${selector}`);
  return element;
}

function panelElements(root: HTMLElement): PanelElements {
  return {
    root,
    loading: requiredElement(root, '[data-deq-loading]'),
    login: requiredElement(root, '[data-deq-login]'),
    body: requiredElement(root, '[data-deq-body]'),
    error: requiredElement(root, '[data-deq-error]'),
    errorMessage: requiredElement(root, '[data-deq-error-message]'),
    loadRetry: requiredElement(root, '[data-deq-load-retry]'),
    refresh: requiredElement(root, '[data-deq-refresh]'),
    announcer: requiredElement(root, '[data-deq-announcer]'),
    bonuses: requiredElement(root, '[data-deq-bonuses]'),
    slots: requiredElement(root, '[data-deq-slots]'),
    inventory: requiredElement(root, '[data-deq-inventory]'),
    inventoryCount: requiredElement(root, '[data-deq-inventory-count]'),
    ownedSection: requiredElement(root, '.deq-owned'),
    comparison: requiredElement(root, '[data-deq-comparison]'),
    comparisonContent: requiredElement(root, '[data-deq-comparison-content]'),
    closeComparison: requiredElement(root, '[data-deq-close-comparison]'),
    mutationFeedback: requiredElement(root, '[data-deq-mutation-feedback]'),
    mutationMessage: requiredElement(root, '[data-deq-mutation-message]'),
    mutationRetry: requiredElement(root, '[data-deq-mutation-retry]'),
    filters: [...root.querySelectorAll<HTMLButtonElement>('[data-deq-filter]')],
  };
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function slotIcon(slot: DungeonEquipmentSlot): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const definition of SLOT_ICON_PATHS[slot]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', definition);
    svg.append(path);
  }
  return svg;
}

function formatBonus(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('en-US')}`;
}

function rarityLabel(rarity: string): string {
  return RARITY_LABELS[rarity] || 'غير معروف';
}

function rarityChip(rarity: string): HTMLSpanElement {
  const chip = node('span', 'deq-rarity', rarityLabel(rarity));
  if (Object.hasOwn(RARITY_LABELS, rarity)) chip.dataset.rarity = rarity;
  return chip;
}

function bonusChips(bonuses: DungeonEquipmentBonuses, includeZeros = false): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const stat of DUNGEON_EQUIPMENT_STATS) {
    const value = bonuses[stat];
    if (!includeZeros && value === 0) continue;
    fragment.append(node('span', 'deq-stat-chip', `${formatBonus(value)} ${STAT_LABELS[stat]}`));
  }
  return fragment;
}

function emptyLoadout(): DungeonEquipmentLoadout {
  return {
    loadoutVersion: 0,
    slots: { weapon: null, helmet: null, armor: null, boots: null },
    totalBonuses: { attack: 0, defense: 0, health: 0, dodge: 0 },
  };
}

function totalBonuses(slots: DungeonEquipmentLoadout['slots']): DungeonEquipmentBonuses {
  const total = { attack: 0, defense: 0, health: 0, dodge: 0 };
  for (const slot of DUNGEON_EQUIPMENT_SLOTS) {
    const item = slots[slot];
    if (!item) continue;
    for (const stat of DUNGEON_EQUIPMENT_STATS) total[stat] += item.bonuses[stat];
  }
  return total;
}

function demoItem(
  itemKey: string,
  itemName: string,
  slot: DungeonEquipmentSlot,
  rarity: string,
  bonuses: Partial<DungeonEquipmentBonuses>,
  ownedQuantity = 1,
  equipped = false
): DungeonEquipmentOwnedItem {
  return {
    itemKey,
    itemName,
    slot,
    rarity,
    bonuses: { attack: 0, defense: 0, health: 0, dodge: 0, ...bonuses },
    ownedQuantity,
    equipped,
    equippedRequiredQuantity: equipped ? 1 : 0,
    unequippedAvailableQuantity: Math.max(0, ownedQuantity - (equipped ? 1 : 0)),
  };
}

const DEMO_COMMON_ITEMS = [
  demoItem('dungeon.equipment.rusty_sword', 'السيف الصدئ', 'weapon', 'common', { attack: 2 }),
  demoItem('dungeon.equipment.leather_helmet', 'خوذة الجلد', 'helmet', 'common', { defense: 1, health: 1 }),
  demoItem('dungeon.equipment.leather_armor', 'درع الجلد', 'armor', 'common', { defense: 2, health: 2 }),
  demoItem('dungeon.equipment.traveler_boots', 'حذاء المسافر', 'boots', 'common', { dodge: 2 }),
];

const DEMO_RARE_ITEMS = [
  demoItem('dungeon.equipment.ember_blade', 'نصل الجمر', 'weapon', 'rare', { attack: 5, dodge: 1 }, 2),
  demoItem('dungeon.equipment.iron_helmet', 'خوذة الحديد', 'helmet', 'rare', { defense: 3, health: 2 }),
  demoItem('dungeon.equipment.guardian_armor', 'درع الحارس', 'armor', 'rare', { defense: 4, health: 5 }),
  demoItem('dungeon.equipment.shadow_boots', 'حذاء الظلال', 'boots', 'rare', { dodge: 4, defense: 1 }),
];

function cloneOwnedItem(item: DungeonEquipmentOwnedItem): DungeonEquipmentOwnedItem {
  return { ...item, bonuses: { ...item.bonuses } };
}

function demoLoadout(items: readonly DungeonEquipmentOwnedItem[]): DungeonEquipmentLoadout {
  const slots = emptyLoadout().slots;
  for (const owned of items) {
    const item = cloneOwnedItem(owned);
    item.equipped = true;
    item.equippedRequiredQuantity = 1;
    item.unequippedAvailableQuantity = Math.max(0, item.ownedQuantity - 1);
    slots[item.slot] = item;
  }
  return { loadoutVersion: 4, slots, totalBonuses: totalBonuses(slots) };
}

export class DemoDungeonEquipmentApi implements DungeonEquipmentApiContract {
  private loadout: DungeonEquipmentLoadout;
  private inventory: DungeonEquipmentOwnedItem[];

  constructor(private readonly scenario: string) {
    const common = DEMO_COMMON_ITEMS.map(cloneOwnedItem);
    const rare = DEMO_RARE_ITEMS.map(cloneOwnedItem);

    if (scenario === 'empty') {
      this.loadout = emptyLoadout();
      this.inventory = [];
    } else if (scenario === 'rusty') {
      this.loadout = emptyLoadout();
      this.inventory = [cloneOwnedItem(common[0])];
    } else if (scenario === 'rare') {
      this.loadout = demoLoadout(rare);
      this.inventory = rare.map((item) => ({ ...cloneOwnedItem(item), equipped: true, equippedRequiredQuantity: 1 }));
    } else {
      this.loadout = demoLoadout(common);
      this.inventory = [...common, ...rare].map(cloneOwnedItem);
      this.syncInventory();
    }
  }

  private syncInventory(): void {
    this.inventory = this.inventory.map((item) => {
      const equipped = this.loadout.slots[item.slot]?.itemKey === item.itemKey;
      return {
        ...item,
        equipped,
        equippedRequiredQuantity: equipped ? 1 : 0,
        unequippedAvailableQuantity: Math.max(0, item.ownedQuantity - (equipped ? 1 : 0)),
      };
    });
  }

  async getLoadout(): Promise<DungeonEquipmentLoadout> {
    if (this.scenario === 'feature-off') {
      throw new DungeonEquipmentHttpError(404, 'NOT_FOUND', 'المسار غير موجود.');
    }
    if (this.scenario === 'unauthorized') {
      throw new DungeonEquipmentHttpError(401, 'DUNGEON_EQUIPMENT_UNAUTHENTICATED', 'يجب تسجيل الدخول.');
    }
    if (this.scenario === 'error') throw new TypeError('Mock network error');
    return structuredClone(this.loadout);
  }

  async getInventory(): Promise<DungeonEquipmentInventory> {
    return { items: structuredClone(this.inventory) };
  }

  async mutate(operation: DungeonEquipmentMutationOperation): Promise<DungeonEquipmentMutationResult> {
    let outcome: DungeonEquipmentMutationOutcome;
    if (operation.kind === 'equip') {
      if (!operation.item)
        throw new DungeonEquipmentHttpError(400, 'DUNGEON_EQUIPMENT_VALIDATION_ERROR', 'طلب غير صالح.');
      const current = this.loadout.slots[operation.slot];
      if (current?.itemKey === operation.item.itemKey) outcome = 'already_equipped';
      else {
        outcome = current ? 'replaced' : 'equipped';
        this.loadout.slots[operation.slot] = { ...operation.item, bonuses: { ...operation.item.bonuses } };
        this.loadout.loadoutVersion += 1;
      }
    } else if (this.loadout.slots[operation.slot]) {
      this.loadout.slots[operation.slot] = null;
      this.loadout.loadoutVersion += 1;
      outcome = 'unequipped';
    } else {
      outcome = 'already_unequipped';
    }

    this.loadout.totalBonuses = totalBonuses(this.loadout.slots);
    this.syncInventory();
    return { ...structuredClone(this.loadout), ok: true, outcome, replayed: false, changedSlot: operation.slot };
  }
}

export class DungeonEquipmentPanelController {
  private readonly elements: PanelElements;
  private readonly state: PanelState = {
    initialized: false,
    destroyed: false,
    featureUnavailable: false,
    loading: false,
    mutating: false,
    loadout: null,
    inventory: [],
    filter: 'all',
    selectedItem: null,
    pendingOperation: null,
    loadController: null,
    mutationController: null,
    loadPromise: null,
    slotButtons: new Map(),
    itemButtons: new Map(),
  };
  private readonly api: DungeonEquipmentApiContract;
  private readonly demoScenario: string | null;
  private profileObserver: MutationObserver | null = null;

  constructor(root: HTMLElement) {
    this.elements = panelElements(root);
    this.demoScenario =
      root.dataset.demo === 'true' ? new URLSearchParams(location.search).get('scenario') || 'common' : null;
    const baseUrl = (root.dataset.apiBase || 'https://api.tnx6.xyz').replace(/\/$/, '');
    this.api = this.demoScenario ? new DemoDungeonEquipmentApi(this.demoScenario) : new DungeonEquipmentApi(baseUrl);
    this.bindEvents();
  }

  start(): void {
    if (this.state.destroyed) return;
    if (this.demoScenario) {
      void this.load(true);
      return;
    }

    if (new URLSearchParams(location.search).has('user')) {
      this.elements.root.hidden = true;
      return;
    }

    const profileView = document.getElementById('profileView');
    if (!profileView) return;
    const startWhenReady = () => {
      if (!profileView.classList.contains('hidden') && !this.state.initialized) void this.load(true);
    };
    this.profileObserver = new MutationObserver(startWhenReady);
    this.profileObserver.observe(profileView, { attributes: true, attributeFilter: ['class'] });
    startWhenReady();
  }

  destroy(): void {
    this.state.destroyed = true;
    this.profileObserver?.disconnect();
    this.profileObserver = null;
    this.state.loadController?.abort();
    this.state.mutationController?.abort();
    activePanels.delete(this);
  }

  private bindEvents(): void {
    this.elements.refresh.addEventListener('click', () => void this.load(false));
    this.elements.loadRetry.addEventListener('click', () => void this.load(true));
    this.elements.closeComparison.addEventListener('click', () => this.clearSelection(true));
    this.elements.mutationRetry.addEventListener('click', () => {
      if (this.state.pendingOperation) void this.runMutation(this.state.pendingOperation);
    });

    for (const button of this.elements.filters) {
      button.addEventListener('click', () => {
        const value = button.dataset.deqFilter;
        if (value === 'all' || DUNGEON_EQUIPMENT_SLOTS.includes(value as DungeonEquipmentSlot)) {
          this.setFilter(value as EquipmentFilter, true);
        }
      });
    }
  }

  private announce(message: string): void {
    this.elements.announcer.textContent = '';
    window.setTimeout(() => {
      if (!this.state.destroyed) this.elements.announcer.textContent = message;
    }, 20);
  }

  private setLoadingView(message: string, initial: boolean): void {
    this.state.loading = true;
    this.elements.refresh.disabled = true;
    if (initial) {
      this.elements.root.hidden = false;
      this.elements.loading.hidden = false;
      this.elements.body.hidden = true;
      this.elements.error.hidden = true;
      this.elements.login.hidden = true;
    }
    this.announce(message);
    this.syncMutationControls();
  }

  private showLogin(): void {
    this.elements.root.hidden = false;
    this.elements.loading.hidden = true;
    this.elements.body.hidden = true;
    this.elements.error.hidden = true;
    this.elements.login.hidden = false;
    this.elements.refresh.disabled = true;
    this.elements.mutationFeedback.hidden = true;
  }

  private showInitialError(error: unknown): void {
    this.elements.root.hidden = false;
    this.elements.loading.hidden = true;
    this.elements.body.hidden = true;
    this.elements.login.hidden = true;
    this.elements.error.hidden = false;
    this.elements.errorMessage.textContent = equipmentErrorMessage(error, 'load');
    this.elements.refresh.disabled = true;
  }

  private hideAsUnavailable(): void {
    this.state.featureUnavailable = true;
    this.elements.root.hidden = true;
    this.state.loadController?.abort();
  }

  private async load(initial: boolean): Promise<boolean> {
    if (this.state.destroyed || this.state.featureUnavailable || this.state.mutating) return false;
    if (this.state.loadPromise) return this.state.loadPromise;

    this.state.loadController?.abort();
    const controller = new AbortController();
    this.state.loadController = controller;
    this.setLoadingView('تحميل تجهيزاتك.', initial || !this.state.loadout);

    const task = (async () => {
      try {
        const dataPromise = loadDungeonEquipmentData(
          {
            getLoadout: async (signal) => {
              const loadout = await this.api.getLoadout(signal);
              this.announce('تحميل المعدات.');
              return loadout;
            },
            getInventory: (signal) => this.api.getInventory(signal),
          },
          controller.signal
        );
        const { loadout, inventory } = await dataPromise;
        if (controller.signal.aborted || this.state.destroyed) return false;

        this.state.loadout = loadout;
        this.state.inventory = inventory.items;
        this.state.initialized = true;
        this.state.loading = false;
        if (
          this.state.selectedItem &&
          !this.state.inventory.some(
            (item) => item.itemKey === this.state.selectedItem?.itemKey && item.slot === this.state.selectedItem.slot
          )
        ) {
          this.state.selectedItem = null;
        }

        this.elements.root.hidden = false;
        this.elements.loading.hidden = true;
        this.elements.login.hidden = true;
        this.elements.error.hidden = true;
        this.elements.body.hidden = false;
        this.render();
        this.announce('تم تحميل المعدات.');

        if (initial && this.demoScenario === 'comparison') {
          const selected = this.state.inventory.find((item) => item.slot === 'weapon' && item.rarity === 'rare');
          if (selected) this.selectItem(selected, false);
        }

        return true;
      } catch (error) {
        if (controller.signal.aborted || this.state.destroyed) return false;
        if (isDungeonEquipmentFeatureUnavailable(error)) {
          this.hideAsUnavailable();
          return false;
        }
        if (isDungeonEquipmentUnauthenticated(error)) {
          this.showLogin();
          return false;
        }
        if (!this.state.loadout || initial) this.showInitialError(error);
        else this.showMutationFeedback(equipmentErrorMessage(error, 'load'), false);
        return false;
      } finally {
        if (this.state.loadController === controller) this.state.loadController = null;
        this.state.loading = false;
        this.state.loadPromise = null;
        this.elements.refresh.disabled =
          this.state.mutating || this.state.featureUnavailable || !this.state.initialized;
        this.syncMutationControls();
      }
    })();

    this.state.loadPromise = task;
    return task;
  }

  private render(): void {
    this.renderBonuses();
    this.renderSlots();
    this.renderInventory();
    this.renderComparison();
    this.syncFilters();
    this.syncMutationControls();
  }

  private renderBonuses(): void {
    const fragment = document.createDocumentFragment();
    const bonuses = this.state.loadout?.totalBonuses || emptyLoadout().totalBonuses;
    for (const stat of DUNGEON_EQUIPMENT_STATS) {
      const item = node('div', 'deq-bonus');
      item.append(node('span', '', STAT_LABELS[stat]), node('strong', '', formatBonus(bonuses[stat])));
      fragment.append(item);
    }
    this.elements.bonuses.replaceChildren(fragment);
  }

  private renderSlots(): void {
    const fragment = document.createDocumentFragment();
    this.state.slotButtons.clear();
    const loadout = this.state.loadout || emptyLoadout();

    for (const slot of DUNGEON_EQUIPMENT_SLOTS) {
      const equipped = loadout.slots[slot];
      const article = node('article', 'deq-slot');
      article.dataset.active = String(this.state.filter === slot);

      const select = node('button', 'deq-slot__select');
      select.type = 'button';
      select.setAttribute('aria-label', `عرض معدات ${SLOT_LABELS[slot]}`);
      select.addEventListener('click', () => this.selectSlot(slot));
      this.state.slotButtons.set(slot, select);

      const top = node('span', 'deq-slot__top');
      const icon = node('span', 'deq-slot__icon');
      icon.append(slotIcon(slot));
      top.append(icon, node('span', 'deq-slot__label', SLOT_LABELS[slot]));
      if (equipped) top.append(node('span', 'deq-slot__status', 'مجهز'));

      select.append(top, node('strong', 'deq-slot__name', equipped?.itemName || 'غير مجهز'));
      const meta = node('span', 'deq-slot__meta');
      if (equipped) meta.append(rarityChip(equipped.rarity), bonusChips(equipped.bonuses));
      else meta.append(node('span', 'deq-stat-chip', `عرض ${SLOT_FILTER_LABELS[slot]}`));
      select.append(meta);
      article.append(select);

      if (equipped) {
        const remove = node('button', 'deq-slot__remove', 'فك التجهيز');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          const operation = createDungeonEquipmentOperation('unequip', slot, null);
          void this.runMutation(operation);
        });
        article.append(remove);
      }

      fragment.append(article);
    }

    this.elements.slots.replaceChildren(fragment);
  }

  private renderInventory(): void {
    const items = filterDungeonEquipmentItems(this.state.inventory, this.state.filter);
    const fragment = document.createDocumentFragment();
    this.state.itemButtons.clear();
    this.elements.inventoryCount.textContent = `${this.state.inventory.length.toLocaleString('ar-SA')} قطعة`;

    if (items.length === 0) {
      const message = this.state.inventory.length === 0 ? 'لم تحصل على معدات دنجن بعد.' : 'لا توجد معدات لهذه الخانة.';
      fragment.append(node('p', 'deq-empty', message));
    } else {
      for (const item of items) {
        const article = node('article', 'deq-item');
        article.dataset.selected = String(
          this.state.selectedItem?.itemKey === item.itemKey && this.state.selectedItem.slot === item.slot
        );

        const select = node('button', 'deq-item__select');
        select.type = 'button';
        select.setAttribute('aria-label', `اختيار ${item.itemName} للمقارنة`);
        select.addEventListener('click', () => this.selectItem(item, true));
        this.state.itemButtons.set(item, select);

        const top = node('span', 'deq-item__top');
        top.append(
          node('strong', 'deq-item__name', item.itemName),
          node('span', 'deq-item__slot', SLOT_LABELS[item.slot])
        );
        select.append(top);

        const meta = node('span', 'deq-item__meta');
        meta.append(rarityChip(item.rarity), bonusChips(item.bonuses));
        if (item.equipped) meta.append(node('span', 'deq-equipped-badge', 'مجهزة'));
        select.append(meta);

        const quantity = node('span', 'deq-item__quantity');
        const owned = node('span');
        owned.append('تملك ', node('strong', '', item.ownedQuantity.toLocaleString('ar-SA')));
        const available = node('span');
        available.append('متاح ', node('strong', '', item.unequippedAvailableQuantity.toLocaleString('ar-SA')));
        quantity.append(owned, available);
        select.append(quantity);

        article.append(select);
        fragment.append(article);
      }
    }

    this.elements.inventory.replaceChildren(fragment);
  }

  private renderComparison(): void {
    const selected = this.state.selectedItem;
    if (!selected || !this.state.loadout) {
      this.elements.comparison.hidden = true;
      this.elements.comparisonContent.replaceChildren();
      return;
    }

    const current = this.state.loadout.slots[selected.slot];
    const sameItem = current?.itemKey === selected.itemKey;
    const content = node('div');
    const names = node('div', 'deq-comparison__names');
    names.append(
      this.comparisonItem('القطعة الحالية', current),
      node('span', 'deq-comparison__versus', 'مقابل'),
      this.comparisonItem('القطعة المختارة', selected, true)
    );
    content.append(names);

    const stats = node('div', 'deq-comparison__stats');
    for (const row of compareDungeonEquipment(current, selected)) {
      const item = node('div', 'deq-comparison__stat');
      item.dataset.change = row.difference > 0 ? 'positive' : row.difference < 0 ? 'negative' : 'same';
      item.append(
        node('span', '', STAT_LABELS[row.stat]),
        node('strong', '', row.difference === 0 ? 'بدون تغيير' : formatBonus(row.difference))
      );
      stats.append(item);
    }
    content.append(stats);

    const footer = node('div', 'deq-comparison__footer');
    const note = node(
      'p',
      'deq-comparison__note',
      sameItem
        ? 'هذه القطعة مجهزة حاليًا.'
        : selected.unequippedAvailableQuantity > 0
          ? `سيتم تجهيزها في خانة ${SLOT_LABELS[selected.slot]}.`
          : 'لا توجد نسخة متاحة للتجهيز.'
    );
    const equip = node('button', 'deq-comparison__action', this.state.mutating ? 'جاري التجهيز' : 'تجهيز القطعة');
    equip.type = 'button';
    equip.disabled = sameItem || selected.unequippedAvailableQuantity < 1 || this.state.mutating || this.state.loading;
    equip.addEventListener('click', () => {
      const operation = createDungeonEquipmentOperation('equip', selected.slot, selected);
      void this.runMutation(operation);
    });
    footer.append(note, equip);
    content.append(footer);

    this.elements.comparisonContent.replaceChildren(content);
    this.elements.comparison.hidden = false;
  }

  private comparisonItem(label: string, item: DungeonEquipmentItem | null, selected = false): HTMLElement {
    const element = node('div', `deq-comparison__item${selected ? ' deq-comparison__item--selected' : ''}`);
    element.append(node('span', '', label), node('strong', '', item?.itemName || 'لا توجد قطعة'));
    if (item) {
      const meta = node('div', 'deq-item__meta');
      meta.append(rarityChip(item.rarity), bonusChips(item.bonuses, true));
      element.append(meta);
    }
    return element;
  }

  private selectSlot(slot: DungeonEquipmentSlot): void {
    this.setFilter(slot, false);
    if (matchMedia('(max-width: 720px)').matches) {
      this.elements.ownedSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  private setFilter(filter: EquipmentFilter, focusInventory: boolean): void {
    this.state.filter = filter;
    if (this.state.selectedItem && filter !== 'all' && this.state.selectedItem.slot !== filter) {
      this.state.selectedItem = null;
    }
    this.renderSlots();
    this.renderInventory();
    this.renderComparison();
    this.syncFilters();
    if (focusInventory)
      this.elements.inventory.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }

  private syncFilters(): void {
    for (const button of this.elements.filters) {
      button.setAttribute('aria-pressed', String(button.dataset.deqFilter === this.state.filter));
      button.disabled = this.state.loading || this.state.mutating;
    }
  }

  private selectItem(item: DungeonEquipmentOwnedItem, focusComparison: boolean): void {
    this.state.selectedItem = item;
    this.state.filter = item.slot;
    this.renderSlots();
    this.renderInventory();
    this.renderComparison();
    this.syncFilters();
    if (focusComparison) {
      this.elements.comparison.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.elements.closeComparison.focus({ preventScroll: true });
    }
  }

  private clearSelection(restoreFocus: boolean): void {
    const selected = this.state.selectedItem;
    this.state.selectedItem = null;
    this.renderInventory();
    this.renderComparison();
    if (restoreFocus && selected) {
      const button = [...this.state.itemButtons.entries()].find(
        ([item]) => item.itemKey === selected.itemKey && item.slot === selected.slot
      )?.[1];
      button?.focus({ preventScroll: true });
    }
  }

  private showMutationFeedback(message: string, retry: boolean): void {
    this.elements.mutationMessage.textContent = message;
    this.elements.mutationRetry.hidden = !retry;
    this.elements.mutationFeedback.hidden = false;
    this.announce(message);
  }

  private hideMutationFeedback(): void {
    this.elements.mutationFeedback.hidden = true;
    this.elements.mutationRetry.hidden = true;
    this.elements.mutationMessage.textContent = '';
  }

  private syncMutationControls(): void {
    const disabled = this.state.loading || this.state.mutating;
    this.elements.refresh.disabled = disabled || !this.state.initialized;
    for (const button of this.elements.slots.querySelectorAll<HTMLButtonElement>('button')) button.disabled = disabled;
    for (const button of this.elements.inventory.querySelectorAll<HTMLButtonElement>('button'))
      button.disabled = disabled;
    this.syncFilters();
  }

  private async runMutation(operation: DungeonEquipmentMutationOperation): Promise<void> {
    if (this.state.destroyed || this.state.mutating || this.state.loading) return;
    this.state.pendingOperation = operation;
    this.state.mutating = true;
    this.hideMutationFeedback();
    this.renderComparison();
    this.syncMutationControls();
    this.showMutationFeedback(operation.kind === 'equip' ? 'جاري التجهيز.' : 'جاري فك التجهيز.', false);

    const controller = new AbortController();
    this.state.mutationController?.abort();
    this.state.mutationController = controller;
    const focusSlot = operation.slot;

    try {
      const result = await this.api.mutate(operation, controller.signal);
      if (controller.signal.aborted || this.state.destroyed) return;
      this.state.pendingOperation = null;
      const message = OUTCOME_MESSAGES[result.outcome];
      const refreshed = await this.loadAfterMutation();
      this.showMutationFeedback(refreshed ? message : `${message} تعذر تحديث العرض الآن.`, false);
      this.state.slotButtons.get(focusSlot)?.focus({ preventScroll: true });
    } catch (error) {
      if (controller.signal.aborted || this.state.destroyed) return;
      if (isDungeonEquipmentUnauthenticated(error)) {
        this.state.pendingOperation = null;
        this.showLogin();
      } else if (isDungeonEquipmentConcurrencyError(error)) {
        this.state.pendingOperation = null;
        this.showMutationFeedback(equipmentErrorMessage(error, 'mutation'), false);
        await this.loadAfterMutation();
      } else {
        const uncertainNetworkFailure = !(error instanceof DungeonEquipmentHttpError);
        if (!uncertainNetworkFailure) this.state.pendingOperation = null;
        this.showMutationFeedback(equipmentErrorMessage(error, 'mutation'), uncertainNetworkFailure);
      }
    } finally {
      if (this.state.mutationController === controller) this.state.mutationController = null;
      this.state.mutating = false;
      this.render();
    }
  }

  private async loadAfterMutation(): Promise<boolean> {
    const controller = new AbortController();
    this.state.loadController?.abort();
    this.state.loadController = controller;
    try {
      const { loadout, inventory } = await loadDungeonEquipmentData(this.api, controller.signal);
      if (controller.signal.aborted || this.state.destroyed) return false;
      this.state.loadout = loadout;
      this.state.inventory = inventory.items;
      this.state.selectedItem = null;
      this.render();
      return true;
    } catch (error) {
      if (isDungeonEquipmentUnauthenticated(error)) this.showLogin();
      if (isDungeonEquipmentFeatureUnavailable(error)) this.hideAsUnavailable();
      return false;
    } finally {
      if (this.state.loadController === controller) this.state.loadController = null;
    }
  }
}

function installLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  const cleanup = () => {
    for (const panel of [...activePanels]) panel.destroy();
  };
  window.addEventListener('pagehide', cleanup);
  document.addEventListener('astro:before-swap', cleanup);
  document.addEventListener('astro:page-load', installDungeonEquipmentPanels);
}

export function installDungeonEquipmentPanels(): void {
  installLifecycle();
  for (const root of document.querySelectorAll<HTMLElement>('[data-dungeon-equipment-root]')) {
    if (installedRoots.has(root)) continue;
    installedRoots.add(root);
    const panel = new DungeonEquipmentPanelController(root);
    activePanels.add(panel);
    panel.start();
  }
}
