import {
  DungeonMasteryApi,
  dungeonMasteryErrorMessage,
  isDungeonMasteryFeatureUnavailable,
  isDungeonMasteryRetryable,
  isDungeonMasteryUnauthenticated,
  type DungeonMasteryOverview,
} from './dungeon-mastery-model';

const numberFormatter = new Intl.NumberFormat('ar-SA');
const dateFormatter = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const PROFILE_CONTEXT_CHANGE_EVENT = 'tnx:profile-route-change';
const controllers = new WeakMap<HTMLElement, DungeonMasteryPanelController>();
const retiredRoots = new WeakSet<HTMLElement>();

function element<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const match = root.querySelector<T>(selector);
  if (!match) throw new Error(`Missing Dungeon Mastery element: ${selector}`);
  return match;
}

function setText(target: HTMLElement, value: string): void {
  target.textContent = value;
}

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function isPublicProfile(): boolean {
  return new URLSearchParams(window.location.search).has('user');
}

class DungeonMasteryPanelController {
  private readonly root: HTMLElement;
  private readonly profileView = document.querySelector<HTMLElement>('#profileView');
  private readonly loading: HTMLElement;
  private readonly login: HTMLElement;
  private readonly error: HTMLElement;
  private readonly body: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly refresh: HTMLButtonElement;
  private readonly announcer: HTMLElement;
  private abortController: AbortController | null = null;
  private visibilityObserver: MutationObserver | null = null;
  private disposed = false;
  private routeEligible = false;
  private featureUnavailable = false;
  private requestGeneration = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.loading = element(root, '[data-dma-loading]');
    this.login = element(root, '[data-dma-login]');
    this.error = element(root, '[data-dma-error]');
    this.body = element(root, '[data-dma-body]');
    this.retry = element(root, '[data-dma-retry]');
    this.refresh = element(root, '[data-dma-refresh]');
    this.announcer = element(root, '[data-dma-announcer]');
    this.setRefreshState(false, false);
    this.retry.addEventListener('click', this.load);
    this.refresh.addEventListener('click', this.load);
  }

  start(): void {
    if (isPublicProfile()) {
      this.hideForPublicProfile();
      return;
    }
    this.routeEligible = true;
    if (!this.profileView) return;
    if (this.profileIsVisible()) {
      void this.load();
      return;
    }
    this.visibilityObserver = new MutationObserver(() => {
      if (!this.profileIsVisible()) return;
      this.visibilityObserver?.disconnect();
      this.visibilityObserver = null;
      void this.load();
    });
    this.visibilityObserver.observe(this.profileView, { attributes: true, attributeFilter: ['class', 'hidden'] });
  }

  dispose(): void {
    retiredRoots.add(this.root);
    this.disposed = true;
    this.requestGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.clearForDormancy();
    this.retry.removeEventListener('click', this.load);
    this.refresh.removeEventListener('click', this.load);
    controllers.delete(this.root);
  }

  reconcileRoute(): void {
    if (isPublicProfile()) {
      this.hideForPublicProfile();
      return;
    }
    if (!this.routeEligible && !this.disposed) this.start();
  }

  private profileIsVisible(): boolean {
    return Boolean(this.profileView && !this.profileView.hidden && !this.profileView.classList.contains('hidden'));
  }

  private readonly load = async (): Promise<void> => {
    if (this.disposed || this.featureUnavailable) return;
    if (isPublicProfile()) {
      this.hideForPublicProfile();
      return;
    }
    const generation = ++this.requestGeneration;
    this.abortController?.abort();
    const request = new AbortController();
    this.abortController = request;
    this.prepareForRequest();

    try {
      const api = new DungeonMasteryApi(this.root.dataset.apiBase || 'https://api.tnx6.xyz');
      const overview = await api.getOverview(request.signal);
      if (!this.canCommitRequest(generation, request)) return;
      this.renderOverview(overview);
    } catch (error) {
      if (!this.canCommitRequest(generation, request)) return;
      this.renderFailure(error);
    }
  };

  private canCommitRequest(generation: number, request: AbortController): boolean {
    return (
      !this.disposed &&
      !isPublicProfile() &&
      generation === this.requestGeneration &&
      !request.signal.aborted &&
      this.abortController === request
    );
  }

  private prepareForRequest(): void {
    this.clearOverview();
    this.root.hidden = false;
    this.loading.hidden = false;
    this.login.hidden = true;
    this.error.hidden = true;
    this.body.hidden = true;
    this.retry.hidden = true;
    this.setRefreshState(false, false);
    setText(this.announcer, 'جاري تحميل تقدم الإتقان.');
  }

  private setRefreshState(refreshVisible: boolean, refreshEnabled: boolean): void {
    this.refresh.hidden = !refreshVisible;
    this.refresh.disabled = !refreshEnabled;
  }

  private clearOverview(): void {
    element(this.root, '[data-dma-unlocks]').replaceChildren();
    element(this.root, '[data-dma-grants]').replaceChildren();
    for (const selector of [
      '[data-dma-rank]',
      '[data-dma-progress]',
      '[data-dma-stars]',
      '[data-dma-unlock-count]',
      '[data-dma-rank-percent]',
      '[data-dma-rank-next]',
      '[data-dma-rank-remaining]',
      '[data-dma-legacy-percent]',
      '[data-dma-legacy-next]',
      '[data-dma-legacy-remaining]',
    ]) {
      setText(element(this.root, selector), '—');
    }
    this.setProgress('[data-dma-rank-progressbar]', '[data-dma-rank-fill]', 0);
    this.setProgress('[data-dma-legacy-progressbar]', '[data-dma-legacy-fill]', 0);
    element(this.root, '[data-dma-rank-active]').hidden = false;
    element(this.root, '[data-dma-rank-complete]').hidden = true;
    element(this.root, '[data-dma-legacy]').hidden = true;
    element(this.root, '[data-dma-unlocks-empty]').hidden = true;
    element(this.root, '[data-dma-grants-empty]').hidden = true;
    setText(element(this.root, '[data-dma-error-message]'), '');
  }

  private clearForDormancy(): void {
    this.clearOverview();
    this.loading.hidden = true;
    this.login.hidden = true;
    this.error.hidden = true;
    this.body.hidden = true;
    this.retry.hidden = true;
    this.setRefreshState(false, false);
    setText(this.announcer, '');
    this.root.hidden = true;
  }

  private renderOverview(overview: DungeonMasteryOverview): void {
    this.loading.hidden = true;
    this.root.hidden = false;
    this.login.hidden = true;
    this.error.hidden = true;
    this.body.hidden = false;
    this.retry.hidden = true;
    this.setRefreshState(true, true);
    setText(element(this.root, '[data-dma-rank]'), formatNumber(overview.rank));
    setText(element(this.root, '[data-dma-progress]'), formatNumber(overview.progress));
    setText(element(this.root, '[data-dma-stars]'), formatNumber(overview.legacyStars));
    setText(element(this.root, '[data-dma-unlock-count]'), formatNumber(overview.unlocks.length));
    this.renderRankProgress(overview);
    this.renderLegacyProgress(overview);
    this.renderUnlocks(overview);
    this.renderRecentGrants(overview);
    setText(this.announcer, 'تم تحميل تقدم إتقان الدنجن.');
  }

  private renderRankProgress(overview: DungeonMasteryOverview): void {
    const active = element(this.root, '[data-dma-rank-active]');
    const complete = element(this.root, '[data-dma-rank-complete]');
    const progress = overview.rankProgress;
    setText(element(this.root, '[data-dma-rank-percent]'), `${formatNumber(progress.percent)}٪`);
    active.hidden = progress.complete;
    complete.hidden = !progress.complete;
    this.setProgress('[data-dma-rank-progressbar]', '[data-dma-rank-fill]', progress.percent);
    if (progress.complete || progress.nextRank === null || progress.nextRankThreshold === null) return;
    setText(
      element(this.root, '[data-dma-rank-next]'),
      `الرتبة التالية: ${formatNumber(progress.nextRank)} عند ${formatNumber(progress.nextRankThreshold)} نقطة`
    );
    setText(
      element(this.root, '[data-dma-rank-remaining]'),
      `${formatNumber(progress.progressIntoRank)} من ${formatNumber(progress.progressRequired)} · ${formatNumber(progress.remaining)} متبقية`
    );
  }

  private renderLegacyProgress(overview: DungeonMasteryOverview): void {
    const section = element(this.root, '[data-dma-legacy]');
    const progress = overview.legacyProgress;
    section.hidden = progress === null;
    if (!progress) return;
    setText(element(this.root, '[data-dma-legacy-percent]'), `${formatNumber(progress.percent)}٪`);
    setText(
      element(this.root, '[data-dma-legacy-next]'),
      `النجمة التالية: ${formatNumber(progress.nextStar)} عند ${formatNumber(progress.nextStarThreshold)} نقطة`
    );
    setText(
      element(this.root, '[data-dma-legacy-remaining]'),
      `${formatNumber(progress.progressIntoInterval)} من ${formatNumber(progress.progressRequired)} · ${formatNumber(progress.remaining)} متبقية`
    );
    this.setProgress('[data-dma-legacy-progressbar]', '[data-dma-legacy-fill]', progress.percent);
  }

  private renderUnlocks(overview: DungeonMasteryOverview): void {
    const list = element<HTMLUListElement>(this.root, '[data-dma-unlocks]');
    const empty = element(this.root, '[data-dma-unlocks-empty]');
    empty.hidden = overview.unlocks.length !== 0;
    for (const unlock of overview.unlocks) {
      const item = document.createElement('li');
      const copy = document.createElement('div');
      const label = document.createElement('strong');
      const english = document.createElement('span');
      const rank = document.createElement('small');
      label.textContent = unlock.label.ar;
      english.textContent = unlock.label.en;
      english.lang = 'en';
      english.dir = 'ltr';
      rank.textContent = `الرتبة ${formatNumber(unlock.grantingRank)}`;
      copy.append(label, english);
      item.append(copy, rank);
      list.append(item);
    }
  }

  private renderRecentGrants(overview: DungeonMasteryOverview): void {
    const list = element<HTMLOListElement>(this.root, '[data-dma-grants]');
    const empty = element(this.root, '[data-dma-grants-empty]');
    const labels = new Map(overview.unlocks.map((unlock) => [unlock.key, unlock.label.ar]));
    empty.hidden = overview.recentGrants.length !== 0;
    for (const grant of overview.recentGrants) {
      const item = document.createElement('li');
      const heading = document.createElement('div');
      const delta = document.createElement('strong');
      const date = document.createElement('time');
      const meta = document.createElement('p');
      delta.textContent = `+${formatNumber(grant.progressDelta)} نقطة`;
      date.dateTime = grant.createdAt;
      date.textContent = dateFormatter.format(new Date(grant.createdAt));
      meta.textContent = `الرصيد ${formatNumber(grant.progressAfter)} · الرتبة ${formatNumber(grant.rankAfter)} · نجوم Legacy ${formatNumber(grant.legacyStarsAfter)}`;
      heading.append(delta, date);
      item.append(heading, meta);
      if (grant.crossedRanks.length > 0) {
        const crossed = document.createElement('p');
        crossed.textContent = `رتب جديدة: ${grant.crossedRanks.map(formatNumber).join('، ')}`;
        item.append(crossed);
      }
      if (grant.semanticUnlockKeys.length > 0) {
        const unlocks = document.createElement('p');
        unlocks.textContent = `مكافآت جديدة: ${grant.semanticUnlockKeys.map((key) => labels.get(key)!).join('، ')}`;
        item.append(unlocks);
      }
      list.append(item);
    }
  }

  private renderFailure(error: unknown): void {
    this.loading.hidden = true;
    if (isDungeonMasteryFeatureUnavailable(error)) {
      this.featureUnavailable = true;
      this.clearForDormancy();
      this.visibilityObserver?.disconnect();
      this.abortController = null;
      return;
    }
    this.root.hidden = false;
    if (isDungeonMasteryUnauthenticated(error)) {
      this.error.hidden = true;
      this.body.hidden = true;
      this.retry.hidden = true;
      this.setRefreshState(false, false);
      this.login.hidden = false;
      setText(this.announcer, 'تسجيل الدخول مطلوب لعرض تقدم الإتقان.');
      return;
    }
    this.login.hidden = true;
    this.body.hidden = true;
    this.error.hidden = false;
    const retryable = isDungeonMasteryRetryable(error);
    const refreshVisible = retryable;
    const refreshEnabled = retryable;
    this.retry.hidden = !retryable;
    this.setRefreshState(refreshVisible, refreshEnabled);
    setText(element(this.root, '[data-dma-error-message]'), dungeonMasteryErrorMessage(error));
    setText(this.announcer, 'تعذر تحميل تقدم الإتقان.');
  }

  private setProgress(trackSelector: string, fillSelector: string, percent: number): void {
    const track = element(this.root, trackSelector);
    const fill = element(this.root, fillSelector);
    track.setAttribute('aria-valuenow', String(percent));
    fill.style.width = `${percent}%`;
  }

  private hideForPublicProfile(): void {
    this.requestGeneration += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.visibilityObserver?.disconnect();
    this.visibilityObserver = null;
    this.clearForDormancy();
    this.routeEligible = false;
  }
}

export function installDungeonMasteryPanels(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-dungeon-mastery-root]')) {
    if (retiredRoots.has(root)) continue;
    const existing = controllers.get(root);
    if (existing) {
      existing.reconcileRoute();
      continue;
    }
    const controller = new DungeonMasteryPanelController(root);
    controllers.set(root, controller);
    controller.start();
  }
}

function disposeDungeonMasteryPanels(): void {
  for (const root of document.querySelectorAll<HTMLElement>('[data-dungeon-mastery-root]')) {
    retiredRoots.add(root);
    controllers.get(root)?.dispose();
  }
}

document.addEventListener('astro:page-load', installDungeonMasteryPanels);
document.addEventListener('astro:before-swap', disposeDungeonMasteryPanels);
window.addEventListener(PROFILE_CONTEXT_CHANGE_EVENT, installDungeonMasteryPanels);
window.addEventListener('pagehide', disposeDungeonMasteryPanels, { once: true });
