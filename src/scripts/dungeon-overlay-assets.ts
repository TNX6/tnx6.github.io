export interface DungeonSpriteImage {
  src: string;
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event | string) => unknown) | null;
  decode?: () => Promise<void>;
}

export type DungeonSpriteImageFactory = () => DungeonSpriteImage;

export interface DungeonPrimarySpriteAssets {
  idleSheet: string;
  walkFrontSheet: string;
}

export type DungeonPrimaryAssetMode = 'animated' | 'fallback';

const DEFAULT_ASSET_TIMEOUT_MS = 5_000;

export class DungeonSpriteAssetLoader {
  private readonly cache = new Map<string, Promise<boolean>>();
  private readonly imageFactory: DungeonSpriteImageFactory;
  private readonly timeoutMs: number;

  constructor(imageFactory: DungeonSpriteImageFactory = () => new Image(), timeoutMs = DEFAULT_ASSET_TIMEOUT_MS) {
    this.imageFactory = imageFactory;
    this.timeoutMs = timeoutMs;
  }

  load(url: string): Promise<boolean> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    const request = new Promise<boolean>((resolve) => {
      const image = this.imageFactory();
      let settled = false;
      const timer = globalThis.setTimeout(() => finish(false), this.timeoutMs);
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        resolve(loaded);
      };

      image.onerror = () => finish(false);
      image.onload = () => {
        if (typeof image.decode !== 'function') finish(true);
      };
      image.src = url;

      if (typeof image.decode === 'function') {
        void image.decode().then(
          () => finish(true),
          () => finish(false)
        );
      }
    });

    this.cache.set(url, request);
    return request;
  }
}

export async function preloadPrimaryCharacterAssets(
  loader: DungeonSpriteAssetLoader,
  assets: DungeonPrimarySpriteAssets
): Promise<DungeonPrimaryAssetMode> {
  const results = await Promise.all([loader.load(assets.idleSheet), loader.load(assets.walkFrontSheet)]);
  return results.every(Boolean) ? 'animated' : 'fallback';
}
