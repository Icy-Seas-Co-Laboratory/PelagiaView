type BlobLoader = (signal: AbortSignal) => Promise<Blob>;

type CacheEntry = {
  controller: AbortController;
  objectUrl: string;
  promise: Promise<string>;
};

/**
 * Owns authenticated image blob URLs independently of virtualized tile components.
 * Call clear() when the containing page or data scope is left.
 */
export class AuthenticatedImageCache {
  private entries = new Map<string, CacheEntry>();

  constructor(private readonly maxEntries = 2500) {}

  load(key: string, loader: BlobLoader): Promise<string> {
    const existing = this.entries.get(key);
    if (existing) {
      // Map insertion order doubles as a small LRU list.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.promise;
    }

    const entry: CacheEntry = {
      controller: new AbortController(),
      objectUrl: '',
      promise: Promise.resolve('')
    };
    entry.promise = loader(entry.controller.signal)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        if (this.entries.get(key) !== entry) {
          URL.revokeObjectURL(objectUrl);
          const error = new Error('Image cache entry was released.');
          error.name = 'AbortError';
          throw error;
        }
        entry.objectUrl = objectUrl;
        this.evictOverflow();
        return objectUrl;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    this.entries.set(key, entry);
    return entry.promise;
  }

  clear() {
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    this.entries.clear();
  }

  private evictOverflow() {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return;
      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      entry?.controller.abort();
      if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
  }
}
