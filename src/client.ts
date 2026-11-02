/**
 * `TrackCore` — the client a customer constructs.
 *
 * Deliberately small. This SDK is a thin HTTP client (D-015): server
 * capabilities only, no health, no voice, no camera, not in the code and not in
 * the type definitions (SDK-W1). Barcode lookup is a server call. A camera
 * method that does not exist teaches that gap through autocomplete; a method
 * that exists and throws teaches it at 2am in production (D-004, D-015).
 */

import { Credential, type Warn } from "./credentials.js";
import { decodeCapabilityCatalogue, decodeProbeOk } from "./decode.js";
import { ConfigurationError } from "./errors.js";
import { processEnv } from "./environment.js";
import type { CapabilityCatalogue, ProbeOk } from "./models.js";
import type { ResponseCache } from "./cache.js";
import type { RetryPolicy } from "./retry.js";
import {
  Transport,
  type Diagnostic,
  type FetchLike,
} from "./transport.js";
import {
  batchFoods,
  getFood,
  lookupBarcode,
  searchFoods,
  type BatchFoodsOptions,
  type GetFoodOptions,
  type LookupBarcodeOptions,
  type SearchFoodsParams,
} from "./resources/foods.js";
import { extractLabel, type ExtractLabelOptions, type LabelImage } from "./resources/label.js";
import {
  recognizeFood,
  recognizeFridge,
  type RecognizeImageOptions,
} from "./resources/image.js";
import { searchSpeech, searchText, type SearchSpeechOptions } from "./resources/nlp.js";
import type { JsonObject } from "./json.js";
import type { BarcodeLookup, BatchReadResult, Food, SearchResults } from "./models.js";

/** The SDK version, stamped into the `User-Agent`. Kept in step with package.json. */
export const VERSION = "0.1.0";

export const DEFAULT_BASE_URL = "https://api.trackcore.dev";

export interface TrackCoreOptions {
  /**
   * `tc_sk_live_…` (secret, **server only**) or `tc_pk_live_…` (publishable).
   *
   * Falls back to `TRACKCORE_API_KEY` from a real process environment. The
   * fallback never reads a `NEXT_PUBLIC_`/`VITE_` variable, because those are
   * inlined into client bundles and reading one would be a way to get a secret
   * into a browser through the back door.
   *
   * A secret key in a detected browser throws `ConfigurationError` with
   * `reason: "secret_key_in_browser"` — see `src/credentials.ts`.
   */
  readonly apiKey?: string | undefined;
  /** Override for a proxy, a staging environment, or a local service. */
  readonly baseUrl?: string | undefined;
  /** Per-attempt timeout. Default 10 000 ms. */
  readonly timeoutMs?: number | undefined;
  /** Overall budget for a call, retries and backoff included. Default 30 000 ms. */
  readonly deadlineMs?: number | undefined;
  /** Partial overrides for the retry policy. See `src/retry.ts`. */
  readonly retry?: Partial<RetryPolicy> | undefined;
  /**
   * ETag revalidation store (SDK-O4). Off unless supplied; pass
   * `new MemoryResponseCache()` to switch it on. Revalidation only — this SDK
   * has no offline mode.
   */
  readonly cache?: ResponseCache | undefined;
  /** A custom `fetch`, for a corporate proxy or an instrumented client. */
  readonly fetch?: FetchLike | undefined;
  /** Extra headers on every request. Cannot override `Authorization`. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Retry and cache events. Never carries a credential or a user's query. */
  readonly onDiagnostic?: ((d: Diagnostic) => void) | undefined;
  /** Where the secret-key-in-an-unknown-runtime warning goes. */
  readonly warn?: Warn | undefined;
}

export class TrackCore {
  /** Public so the standalone, tree-shakeable functions can reach it. */
  readonly transport: Transport;

  /** Which environment the credential belongs to (PF-K5). */
  readonly environment: "live" | "test";
  /** `"secret"` or `"publishable"`. The key itself is not reachable from here. */
  readonly keyKind: "secret" | "publishable";

  constructor(options: TrackCoreOptions = {}) {
    const key = options.apiKey ?? processEnv("TRACKCORE_API_KEY");
    const credential = Credential.create(key, options.warn);
    this.environment = credential.environment;
    this.keyKind = credential.kind;

    const baseUrl = options.baseUrl ?? processEnv("TRACKCORE_BASE_URL") ?? DEFAULT_BASE_URL;

    this.transport = new Transport({
      baseUrl,
      credential,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      deadlineMs: options.deadlineMs,
      retry: options.retry,
      cache: options.cache,
      // `User-Agent` is set only off-browser: browsers forbid it, and a custom
      // header in its place would make every request a CORS preflight.
      defaultHeaders: { ...options.headers, ...userAgentHeader() },
      onDiagnostic: options.onDiagnostic,
    });
  }

  readonly foods = {
    /** `GET /v1/foods/search`. See {@link searchFoods}. */
    search: (params: SearchFoodsParams): Promise<SearchResults> => searchFoods(this, params),
    /** `GET /v1/foods/{food_id}`. See {@link getFood}. */
    get: (foodId: string, options?: GetFoodOptions): Promise<Food> => getFood(this, foodId, options),
    /** `GET /v1/foods?ids=…`. See {@link batchFoods}. */
    batch: (ids: readonly string[], options?: BatchFoodsOptions): Promise<BatchReadResult> =>
      batchFoods(this, ids, options),
  };

  readonly barcode = {
    /**
     * `GET /v1/foods/barcode/{code}`. A miss resolves; it does not throw.
     * There is no `scan` method in this SDK.
     */
    lookup: (code: string, options?: LookupBarcodeOptions): Promise<BarcodeLookup> =>
      lookupBarcode(this, code, options),
  };

  readonly label = {
    /**
     * `POST /v1/label`. Sends a photo and returns the extraction.
     *
     * Does not open a camera. Pass the bytes from a capture or a file picker.
     * A photo that is not a label resolves with `status: "not_a_label"` and
     * `food: null`. It does not throw.
     */
    extract: (image: LabelImage, options?: ExtractLabelOptions): Promise<JsonObject> =>
      extractLabel(this, image, options),
  };

  readonly image = {
    /**
     * `POST /v1/image/food`. Sends a meal photo and returns TrackCore foods.
     * Does not open a camera. `status: "no_match"` means nothing in the photo
     * was recognised. It does not throw.
     */
    food: (image: LabelImage, options?: RecognizeImageOptions): Promise<JsonObject> =>
      recognizeFood(this, image, options),
    /**
     * `POST /v1/image/fridge`. Same recognition as {@link TrackCore.image.food},
     * for a fridge photo. Requires `ai.fridge`. Holding `ai.food_scan` does
     * not unlock it.
     */
    fridge: (image: LabelImage, options?: RecognizeImageOptions): Promise<JsonObject> =>
      recognizeFridge(this, image, options),
  };

  readonly nlp = {
    /**
     * `POST /v1/nlp` with a transcript. Searches the catalog for ten foods.
     * Does not transcribe.
     */
    search: (text: string, options?: SearchSpeechOptions): Promise<JsonObject> =>
      searchText(this, text, options),
    /**
     * `POST /v1/nlp` with a recording. whisper.cpp turns it into text, then
     * the catalog is searched for ten foods. Pass bytes the app already recorded.
     */
    fromSpeech: (audio: LabelImage, options?: SearchSpeechOptions): Promise<JsonObject> =>
      searchSpeech(this, audio, options),
  };

  readonly capabilities = {
    /**
     * `GET /v1/capabilities` (PF-A2).
     *
     * Every capability, Coming Soon ones included and marked
     * `selectable: false` — PF-A2 requires them visible *and* not selectable,
     * and omitting them would satisfy neither half.
     */
    list: async (options: { signal?: AbortSignal | undefined } = {}): Promise<CapabilityCatalogue> => {
      const response = await this.transport.request({
        method: "GET",
        path: "/v1/capabilities",
        signal: options.signal,
      });
      return decodeCapabilityCatalogue(response.body);
    },
  };

  /** `GET /healthz`. Liveness only: it touches nothing and proves nothing else. */
  async health(options: { signal?: AbortSignal | undefined } = {}): Promise<ProbeOk> {
    const response = await this.transport.request({
      method: "GET",
      path: "/healthz",
      signal: options.signal,
    });
    return decodeProbeOk(response.body);
  }

  /** `tc_sk_live_…abcd`. Safe to log; the key itself is not reachable. */
  describeCredential(): string {
    return this.transport.describeCredential();
  }

  toJSON(): Record<string, unknown> {
    return { environment: this.environment, keyKind: this.keyKind, credential: this.describeCredential() };
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `TrackCore(${this.describeCredential()})`;
  }
}

function userAgentHeader(): Record<string, string> {
  // `navigator` present with a `userAgent` the SDK did not set means a browser
  // or a browser-like runtime, where setting `User-Agent` is a no-op at best.
  const hasNavigator = typeof (globalThis as { navigator?: unknown }).navigator !== "undefined";
  if (hasNavigator) return {};
  return { "User-Agent": `trackcore-js/${VERSION}` };
}

export { ConfigurationError };
