export interface DungeonLayerAssetLoadResult {
  readonly url: string;
  readonly loaded: boolean;
  readonly attempts: number;
}

export type DungeonLayerAssetDecoder = (url: string, timeoutMs: number) => Promise<void>;

interface AssetCacheEntry {
  status: 'loading' | 'ready' | 'failed';
  promise: Promise<DungeonLayerAssetLoadResult>;
  attempts: number;
  failedAt: number;
}

export function decodeDungeonLayerAssetInBrowser(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve();
    };
    const timeout = window.setTimeout(() => finish(new Error(`Asset decode timed out: ${url}`)), timeoutMs);
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        finish();
        return;
      }
      void image.decode().then(
        () => finish(),
        () => finish(new Error(`Asset decode failed: ${url}`))
      );
    };
    image.onerror = () => finish(new Error(`Asset load failed: ${url}`));
    image.src = url;
  });
}

export interface DungeonLayerAssetLoaderOptions {
  readonly decoder?: DungeonLayerAssetDecoder;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly retryCooldownMs?: number;
  readonly maxAttempts?: number;
  readonly now?: () => number;
}

export interface DungeonLayerAssetLoaderCounters {
  requests: number;
  decodeCalls: number;
  cacheHits: number;
}

export class DungeonEquipmentLayerAssetLoader {
  readonly cache = new Map<string, AssetCacheEntry>();
  readonly counters: DungeonLayerAssetLoaderCounters = {
    requests: 0,
    decodeCalls: 0,
    cacheHits: 0,
  };

  private readonly decoder: DungeonLayerAssetDecoder;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly retryCooldownMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(options: DungeonLayerAssetLoaderOptions = {}) {
    this.decoder = options.decoder ?? decodeDungeonLayerAssetInBrowser;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.concurrency = Math.min(6, Math.max(4, options.concurrency ?? 5));
    this.retryCooldownMs = options.retryCooldownMs ?? 3_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    this.now = options.now ?? Date.now;
  }

  load(url: string): Promise<DungeonLayerAssetLoadResult> {
    this.counters.requests += 1;
    const cached = this.cache.get(url);
    if (cached?.status === 'ready' || cached?.status === 'loading') {
      this.counters.cacheHits += 1;
      return cached.promise;
    }
    if (
      cached?.status === 'failed' &&
      (cached.attempts >= this.maxAttempts || this.now() - cached.failedAt < this.retryCooldownMs)
    ) {
      this.counters.cacheHits += 1;
      return cached.promise;
    }

    const attempts = (cached?.attempts ?? 0) + 1;
    const promise = this.schedule(async () => {
      try {
        this.counters.decodeCalls += 1;
        await this.decoder(url, this.timeoutMs);
        const result = { url, loaded: true, attempts } as const;
        this.cache.set(url, { status: 'ready', promise: Promise.resolve(result), attempts, failedAt: 0 });
        return result;
      } catch {
        const result = { url, loaded: false, attempts } as const;
        this.cache.set(url, {
          status: 'failed',
          promise: Promise.resolve(result),
          attempts,
          failedAt: this.now(),
        });
        return result;
      }
    });

    this.cache.set(url, { status: 'loading', promise, attempts, failedAt: 0 });
    return promise;
  }

  loadMany(urls: readonly string[]): Promise<DungeonLayerAssetLoadResult[]> {
    return Promise.all([...new Set(urls)].map((url) => this.load(url)));
  }

  clearFailed(url?: string): void {
    if (url) {
      if (this.cache.get(url)?.status === 'failed') this.cache.delete(url);
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.status === 'failed') this.cache.delete(key);
    }
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.active += 1;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.queue.shift()?.();
          });
      };
      if (this.active < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}
