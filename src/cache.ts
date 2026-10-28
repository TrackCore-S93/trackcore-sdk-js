/**
 * ETag / `If-None-Match` revalidation (SDK-O4). **Revalidation only.**
 *
 * # What this is not
 *
 * It is not an offline cache and there is no offline queue anywhere in this
 * SDK. That was settled on 2026-10-23: portion edits require the network and
 * clients never do their own scaling (SDK-C2, DM-N10). A cache that serves a
 * stored body without asking the server is one step from a client deciding what
 * a food's nutrition is, which is the thing the product exists to stop.
 *
 * So every read still goes to the server. What the cache does is make that read
 * cheap: it sends `If-None-Match` with the stored validator, and a `304` means
 * the stored body is still correct. No TTL, no staleness heuristic, no
 * serve-while-revalidate.
 *
 * # Why the staleness signal matters
 *
 * DM-F5 records that `grounds` ships a Hive cache that is **disabled in code**,
 * because the data had no staleness signal and the team could not tell when a
 * cached food had gone wrong. The ETag is that signal. The nutrition service
 * derives it from the food's own content and deliberately excludes `updated_at`
 * and `provenance.snapshot_at` — both of which change on every read while the
 * server-side cache (T-025) does not exist — so the validator is stable for an
 * unchanged food and a 304 actually fires.
 *
 * It is a **weak** validator (`W/"…"`), which is correct for `If-None-Match` on
 * a GET and is why the server compares weakly.
 *
 * Off by default: a cache that a customer did not ask for is a source of bugs
 * they did not expect.
 */

import type { JsonValue } from "./json.js";

export interface CacheEntry {
  readonly etag: string;
  readonly body: JsonValue;
  /** When it was stored. For eviction order only — never for staleness. */
  readonly storedAt: number;
}

export interface ResponseCache {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

/**
 * A bounded in-memory cache with least-recently-used eviction.
 *
 * Bounded because the natural key is the request URL and a search-as-you-type
 * UI generates one per keystroke; unbounded, a long-lived Node process would
 * accumulate every query any user ever typed. `maxEntries` is published
 * (SDK-O3's principle, applied to the only cache this SDK has) and the current
 * depth is readable from `size`.
 *
 * LRU rather than insert-order: the entries worth keeping are the ones being
 * revalidated, and a `Map` preserves insertion order, so re-inserting on read
 * is all the bookkeeping an LRU needs.
 */
export class MemoryResponseCache implements ResponseCache {
  readonly maxEntries: number;
  readonly #entries = new Map<string, CacheEntry>();

  constructor(maxEntries = 256) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("MemoryResponseCache: maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    // Touch: delete and re-insert moves it to the end of the iteration order.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.#entries.has(key)) this.#entries.delete(key);
    this.#entries.set(key, entry);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}
