/** Host-implemented cache. The library only ever calls it; it never fetches and never persists on its own. */
export interface StorageAdapter {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}
