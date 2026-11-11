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
import { assertValidExternalId } from "./identity.js";
import { processEnv } from "./environment.js";
import type { CapabilityCatalogue, ProbeOk } from "./models.js";
import {
  getDiaryDay,
  getDiaryMeals,
  getDiaryRange,
  logFood,
  editPortion,
  deleteEntry,
  reorderEntries,
  createMeal,
  editMeal,
  deleteMeal,
  copyMeal,
  copyDay,
  clearDay,
  listFavourites,
  addFavourite,
  removeFavourite,
  listRecents,
  searchOwnFoods,
  type DayParams,
  type RangeParams,
  type LogFoodParams,
  type EditPortionParams,
  type CreateMealParams,
  type EditMealParams,
  type CopyParams,
} from "./resources/diary.js";
import {
  createCustomFood,
  deleteCustomFood,
  createRecipe,
  type CreateCustomFoodParams,
  type CreateRecipeParams,
} from "./resources/ownfoods.js";
import { createSession, type CreateSessionParams } from "./resources/auth.js";
import { eraseUser, type EraseUserOptions } from "./resources/users.js";
import type { ErasureReceipt } from "./models.js";
import type {
  DailyNutrition,
  DiaryMeals,
  DiaryRange,
  DiaryMeal,
  LoggedFood,
  CardList,
  DeletionReceipt,
  ReorderResult,
  CopyResult,
  SessionToken,
} from "./models.js";
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
import type { BarcodeLookup, BatchReadResult, Food, NlpResult, SearchResults } from "./models.js";

/** The SDK version, stamped into the `User-Agent`. Kept in step with package.json. */
export const VERSION = "0.2.0";

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

  /**
   * Attributes every **subsequent** request to one of your end users (D-012).
   *
   * `externalId` is your own identifier — a Firebase UID, a database id, a
   * ULID — not a TrackCore one. The gateway creates the matching `app_user`
   * row the first time it sees the pair `(your customer id, this id)`, so
   * there is nothing to register in advance and nothing to await here: this
   * stores a string and returns. Every request the client makes from now on
   * carries it, including ETag revalidations and `health()`.
   *
   * ```ts
   * trackcore.setUser(firebaseUser.uid);   // at sign-in
   * trackcore.clearUser();                 // at sign-out
   * ```
   *
   * The id is validated here, synchronously, and a bad one throws
   * {@link ConfigurationError} with a `reason` naming the rule it broke —
   * before any network call, so a malformed id never reaches the gateway and
   * never creates a row. The rules are the server's (trimmed, 1–255 code
   * points) plus printable ASCII, which the server does not require but which
   * an HTTP header in JavaScript cannot honestly carry otherwise; the long
   * version of that argument is at the top of `src/identity.ts`.
   *
   * @throws ConfigurationError with `reason` one of `external_id_not_a_string`,
   * `external_id_untrimmed`, `external_id_empty`, `external_id_too_long` or
   * `external_id_not_ascii`.
   */
  setUser(externalId: string): void {
    // Validated here as well as in the transport, and not by delegation alone,
    // because the two methods disagree about one value: `null` is how the
    // transport is told to clear, so `setUser(null)` from untyped JavaScript
    // would otherwise sign the user *out* instead of failing. Signing someone
    // out when you asked to sign them in is the kind of bug that only shows up
    // as missing attribution weeks later. `clearUser()` is the only way to
    // clear.
    assertValidExternalId(externalId);
    this.transport.setExternalId(externalId);
  }

  /**
   * Stops attributing requests to an end user. Call this at sign-out.
   *
   * The header is then omitted entirely rather than sent empty. The gateway
   * cannot tell the two apart — it reads an absent `X-External-Id` and a blank
   * one alike as "provision nobody" — so omitting it is what gives a
   * signed-out request one unambiguous shape on the wire.
   */
  clearUser(): void {
    this.transport.setExternalId(null);
  }

  /** The end user requests are currently attributed to, or `null`. */
  get externalId(): string | null {
    return this.transport.externalId;
  }

  /**
   * Sets the end-user session token a device carries (T-126).
   *
   * The device half of the credential: a publishable key says which customer,
   * this says which end user. The token comes from your own backend calling
   * `auth.createSession` with a secret key — a device cannot mint one, by
   * design.
   *
   * ```ts
   * const trackcore = new TrackCore({ apiKey: PUBLISHABLE_KEY });
   * trackcore.setSession(tokenFromYourBackend);
   * await trackcore.diary.day({ date: "2026-11-04" });  // no setUser needed
   * ```
   *
   * The token already says who the end user is, so `setUser` is unnecessary
   * alongside it — and naming a *different* end user is
   * `403 user_scope_violation`.
   *
   * On `401 session_expired`, fetch a fresh token from your backend and call
   * this again. The SDK does not refresh for you: it has no way to reach your
   * backend, and a device that could mint its own replacement would defeat the
   * point.
   */
  setSession(sessionToken: string): void {
    this.transport.setSessionToken(sessionToken);
  }

  /** Clears the session token. The client is then unscoped to any end user. */
  clearSession(): void {
    this.transport.setSessionToken(null);
  }

  /** The session token currently carried, or `null`. */
  get sessionToken(): string | null {
    return this.transport.sessionToken;
  }

  readonly foods = {
    /** `GET /v1/foods/search`. See {@link searchFoods}. */
    search: (params: SearchFoodsParams): Promise<SearchResults> => searchFoods(this, params),
    /** `GET /v1/foods/{food_id}`. See {@link getFood}. */
    get: (foodId: string, options?: GetFoodOptions): Promise<Food> => getFood(this, foodId, options),
    /** `GET /v1/foods?ids=…`. See {@link batchFoods}. */
    batch: (ids: readonly string[], options?: BatchFoodsOptions): Promise<BatchReadResult> =>
      batchFoods(this, ids, options),
    /**
     * The end user's own foods. Reached through `foods` rather than a top-level
     * namespace because a custom food **is** a food: it comes back in the same
     * shape, and `foods.get` resolves one (DM-F6).
     */
    custom: {
      /** `POST /v1/foods/custom`. See {@link createCustomFood}. */
      create: (params: CreateCustomFoodParams): Promise<Food> => createCustomFood(this, params),
      /** `DELETE /v1/foods/custom/{food_id}`. See {@link deleteCustomFood}. */
      delete: (foodId: string, options?: { signal?: AbortSignal }): Promise<DeletionReceipt> =>
        deleteCustomFood(this, foodId, options),
    },
    /** `POST /v1/foods/recipes`. See {@link createRecipe}. */
    recipes: {
      create: (params: CreateRecipeParams): Promise<Food> => createRecipe(this, params),
    },
  };

  /**
   * One end user's food log.
   *
   * Every call needs an end user: `setUser` on a server, or `setSession` on a
   * device. Without one the server answers `403 user_scope_violation`.
   */
  readonly diary = {
    /** `GET /v1/diary/day`. See {@link getDiaryDay}. */
    day: (params: DayParams): Promise<DailyNutrition> => getDiaryDay(this, params),
    /** `GET /v1/diary/meals`. See {@link getDiaryMeals}. */
    meals: (params: DayParams): Promise<DiaryMeals> => getDiaryMeals(this, params),
    /** `GET /v1/diary/range`. See {@link getDiaryRange}. */
    range: (params: RangeParams): Promise<DiaryRange> => getDiaryRange(this, params),
    /** `POST /v1/diary/entries`. See {@link logFood}. */
    log: (params: LogFoodParams): Promise<LoggedFood> => logFood(this, params),
    /** `PATCH /v1/diary/entries/{id}`. See {@link editPortion}. */
    editPortion: (params: EditPortionParams): Promise<LoggedFood> => editPortion(this, params),
    /** `DELETE /v1/diary/entries/{id}`. See {@link deleteEntry}. */
    deleteEntry: (entryId: string, options?: { signal?: AbortSignal }): Promise<DeletionReceipt> =>
      deleteEntry(this, entryId, options),
    /** `POST /v1/diary/entries/reorder`. See {@link reorderEntries}. */
    reorder: (params: { mealId: string; entryIds: readonly string[]; signal?: AbortSignal }): Promise<ReorderResult> =>
      reorderEntries(this, params),
    /** Meals: a name plus a timestamp, not a fixed daypart. */
    createMeal: (params: CreateMealParams): Promise<DiaryMeal> => createMeal(this, params),
    /** `PATCH /v1/diary/meals/{id}`. See {@link editMeal}. */
    editMeal: (params: EditMealParams): Promise<DiaryMeal> => editMeal(this, params),
    /** `DELETE /v1/diary/meals/{id}`. See {@link deleteMeal}. */
    deleteMeal: (mealId: string, options?: { signal?: AbortSignal }): Promise<DeletionReceipt> =>
      deleteMeal(this, mealId, options),
    /** `POST /v1/diary/meals/{id}/copy`. See {@link copyMeal}. */
    copyMeal: (mealId: string, params: CopyParams & { idempotencyKey?: string }): Promise<CopyResult> =>
      copyMeal(this, mealId, params),
    /** `POST /v1/diary/day/copy`. See {@link copyDay}. */
    copyDay: (params: CopyParams & { localDate: string; idempotencyKey?: string }): Promise<CopyResult> =>
      copyDay(this, params),
    /** `DELETE /v1/diary/day`. See {@link clearDay}. */
    clearDay: (params: { date: string; signal?: AbortSignal }): Promise<DeletionReceipt> => clearDay(this, params),
    /** `GET /v1/diary/favourites`. See {@link listFavourites}. */
    favourites: (options?: { limit?: number; signal?: AbortSignal }): Promise<CardList> =>
      listFavourites(this, options),
    /** `POST /v1/diary/favourites/{food_id}`. See {@link addFavourite}. */
    addFavourite: (foodId: string, options?: { signal?: AbortSignal }): Promise<unknown> =>
      addFavourite(this, foodId, options),
    /** `DELETE /v1/diary/favourites/{food_id}`. See {@link removeFavourite}. */
    removeFavourite: (foodId: string, options?: { signal?: AbortSignal }): Promise<DeletionReceipt> =>
      removeFavourite(this, foodId, options),
    /** `GET /v1/diary/recents`. See {@link listRecents}. */
    recents: (options?: { limit?: number; signal?: AbortSignal }): Promise<CardList> => listRecents(this, options),
    /** `GET /v1/diary/foods/search`. The end user's own foods, not the provider's. */
    searchOwnFoods: (params: { q: string; limit?: number; signal?: AbortSignal }): Promise<unknown> =>
      searchOwnFoods(this, params),
  };

  /**
   * Minting end-user session tokens. **Server-side only** — it needs a secret
   * key, so calling it from a device both fails and would be the wrong shape if
   * it did not.
   */
  readonly auth = {
    /** `POST /v1/auth/session`. See {@link createSession}. */
    createSession: (params: CreateSessionParams): Promise<SessionToken> => createSession(this, params),
  };

  /**
   * Erasing an end user. **Server-side only** — it needs a secret key. Call it
   * from the code path that handles "delete my account": every row TrackCore
   * holds for that person goes, and the receipt counts them per table (PF-T5).
   * Idempotent; a repeat returns the original receipt with `replayed: true`.
   */
  readonly users = {
    /** `DELETE /v1/users/{external_id}`. See {@link eraseUser}. */
    delete: (externalId: string, options?: EraseUserOptions): Promise<ErasureReceipt> =>
      eraseUser(this, externalId, options),
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
    search: (text: string, options?: SearchSpeechOptions): Promise<NlpResult> =>
      searchText(this, text, options),
    /**
     * `POST /v1/nlp` with a recording. whisper.cpp turns it into text, then
     * the catalog is searched for ten foods. Pass bytes the app already recorded.
     */
    fromSpeech: (audio: LabelImage, options?: SearchSpeechOptions): Promise<NlpResult> =>
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
