import { decodeCardList, decodeCopyResult, decodeDailyNutrition, decodeDeletionReceipt, decodeDiaryMeal, decodeDiaryMeals, decodeDiaryRange, decodeGoal, decodeLoggedFood, decodeReorderResult } from "../decode.js";
import type { HasTransport } from "./foods";
import { decimalOrNull } from "./profile.js";
import type {
  DailyNutrition,
  Goal,
  DiaryMeals,
  DiaryRange,
  CardList,
  LoggedFood,
  DiaryMeal,
  DeletionReceipt,
  ReorderResult,
  CopyResult,
} from "../models";

/**
 * The diary: one end user's food log.
 *
 * # Every call here needs an end user
 *
 * These routes read and write one person's personal data, so the gateway
 * requires either a **secret key plus `X-External-Id`** (a customer's own
 * backend) or a **publishable key plus a session token** (their app, on a
 * device). Both are set on the client — `setUser` for the first, `setSession`
 * for the second — rather than passed per call, because an entry logged
 * against the wrong end user is not an error anybody notices.
 *
 * Calling one of these with neither is a `403 user_scope_violation` from the
 * server, not a client-side throw: the SDK does not try to guess which of the
 * two credential shapes the caller meant to use.
 *
 * # Dates are the end user's local dates
 *
 * `date`, `from` and `to` are `YYYY-MM-DD` in the end user's own timezone, and
 * the server matches them against the local date recorded when each entry was
 * logged. A 23:50 entry in Europe/London belongs to that London day whatever
 * the UTC date was (DM-D5). Passing a `Date` and letting it stringify through
 * UTC is the mistake this parameter shape exists to make awkward.
 */

export interface DayParams {
  /** `YYYY-MM-DD` in the end user's timezone. */
  readonly date: string;
  /** IANA zone, e.g. `Europe/London`. Only decides what an empty day reports. */
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface RangeParams {
  readonly from: string;
  readonly to: string;
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `GET /v1/diary/day` — one local day's consumed totals.
 *
 * A day with nothing logged is a `200` with every nutrient explicitly zero,
 * never a `404`: zero consumption is a fact about the day (DM-D4).
 *
 * Read `partial_sum` before presenting a total as complete. It is `true` when a
 * nutrient in the total had a contributing food that reported `null`, or that
 * does not model it at all — a magnesium total over two foods out of five is
 * not a magnesium total.
 */
export async function getDiaryDay(client: HasTransport, params: DayParams): Promise<DailyNutrition> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/day",
    query: { date: params.date, timezone: params.timezone },
    signal: params.signal,
  });
  return decodeDailyNutrition(response.body);
}

/**
 * `GET /v1/diary/meals` — the day's meals, their foods and their own totals.
 *
 * The foods here carry no `food_snapshot`: a list of six foods does not need
 * six copies of a food. Each entry has the denormalised name, brand and serving
 * description, plus `food_id` to fetch the rest with.
 */
export async function getDiaryMeals(client: HasTransport, params: DayParams): Promise<DiaryMeals> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/meals",
    query: { date: params.date, timezone: params.timezone },
    signal: params.signal,
  });
  return decodeDiaryMeals(response.body);
}

/**
 * `GET /v1/diary/range` — one total per local day, inclusive at both ends.
 *
 * Days with nothing logged are present with zero totals, so a chart's gaps are
 * zeroes rather than missing points. The span is capped at 366 days.
 */
export async function getDiaryRange(client: HasTransport, params: RangeParams): Promise<DiaryRange> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/range",
    query: { from: params.from, to: params.to, timezone: params.timezone },
    signal: params.signal,
  });
  return decodeDiaryRange(response.body);
}

export interface LogFoodParams {
  readonly externalId: string;
  readonly foodId: string;
  readonly selectedServingId: string;
  /**
   * How many of the serving the end user ate. **Not** the serving's own
   * `base_quantity`, which is how many the serving's nutrition describes —
   * merging the two is how `grounds` arrived at silent zero nutrition (P-004).
   */
  readonly consumedQuantity: number | string;
  readonly eatenAt: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly mealName?: string | undefined;
  readonly mealId?: string | undefined;
  readonly source?: string | undefined;
  /** Replaying with the same key returns the original entry, creating none. */
  readonly idempotencyKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `POST /v1/diary/entries` — log a food, taking a full snapshot of it.
 *
 * The entry stores a complete copy of the food including every serving, so a
 * later change by the provider never rewrites history (P-002), and a portion
 * edit resolves from that copy with no further call.
 */
export async function logFood(client: HasTransport, params: LogFoodParams): Promise<LoggedFood> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/diary/entries",
    body: {
      external_id: params.externalId,
      food_id: params.foodId,
      selected_serving_id: params.selectedServingId,
      consumed_quantity: params.consumedQuantity,
      eaten_at: params.eatenAt,
      local_date: params.localDate,
      timezone: params.timezone,
      meal_name: params.mealName,
      meal_id: params.mealId,
      source: params.source,
    },
    idempotencyKey: params.idempotencyKey,
    signal: params.signal,
  });
  return decodeLoggedFood(response.body);
}

export interface EditPortionParams {
  readonly entryId: string;
  readonly consumedQuantity?: number | string | undefined;
  readonly selectedServingId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `PATCH /v1/diary/entries/{id}` — change the portion.
 *
 * Resolved entirely from the stored snapshot: no provider call, no refetch of
 * the food, and the original snapshot is preserved (DM-L2, DM-L4).
 */
export async function editPortion(client: HasTransport, params: EditPortionParams): Promise<LoggedFood> {
  const response = await client.transport.request({
    method: "PATCH",
    path: `/v1/diary/entries/${encodeURIComponent(params.entryId)}`,
    body: {
      consumed_quantity: params.consumedQuantity,
      selected_serving_id: params.selectedServingId,
    },
    signal: params.signal,
  });
  return decodeLoggedFood(response.body);
}

/** `DELETE /v1/diary/entries/{id}` — remove one logged food. */
export async function deleteEntry(
  client: HasTransport,
  entryId: string,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<DeletionReceipt> {
  const response = await client.transport.request({
    method: "DELETE",
    path: `/v1/diary/entries/${encodeURIComponent(entryId)}`,
    signal: options?.signal,
  });
  return decodeDeletionReceipt(response.body);
}

/**
 * `POST /v1/diary/entries/reorder` — set the display order within one meal.
 *
 * Every entry in the meal must be named. A partial order would leave two
 * entries claiming one position, and the day read would pick between them
 * arbitrarily.
 */
export async function reorderEntries(
  client: HasTransport,
  params: { readonly mealId: string; readonly entryIds: readonly string[]; readonly signal?: AbortSignal | undefined },
): Promise<ReorderResult> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/diary/entries/reorder",
    body: { meal_id: params.mealId, entry_ids: params.entryIds },
    signal: params.signal,
  });
  return decodeReorderResult(response.body);
}

export interface CreateMealParams {
  readonly mealName: string;
  readonly eatenAt: string;
  readonly localDate: string;
  readonly timezone: string;
  readonly flags?: {
    readonly eaten?: boolean;
    readonly custom?: boolean;
    readonly treat?: boolean;
    readonly social?: boolean;
  };
  readonly signal?: AbortSignal | undefined;
}

/**
 * `POST /v1/diary/meals` — create a meal.
 *
 * **Creating a meal in a minute that already has one merges into it** and comes
 * back `200` with `merged: true`, rather than `409` (DM-M1). A meal's identity
 * is its minute, and the minute was already taken by the thing you asked for.
 * A new meal is `201`.
 */
export async function createMeal(client: HasTransport, params: CreateMealParams): Promise<DiaryMeal> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/diary/meals",
    body: {
      meal_name: params.mealName,
      eaten_at: params.eatenAt,
      local_date: params.localDate,
      timezone: params.timezone,
      flags: params.flags,
    },
    signal: params.signal,
  });
  return decodeDiaryMeal(response.body);
}

export interface EditMealParams {
  readonly mealId: string;
  readonly mealName?: string | undefined;
  /** Re-timing needs all three of eatenAt, localDate and timezone together. */
  readonly eatenAt?: string | undefined;
  readonly localDate?: string | undefined;
  readonly timezone?: string | undefined;
  readonly flags?: Readonly<Record<string, boolean>> | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `PATCH /v1/diary/meals/{id}` — rename, re-time or re-flag a meal.
 *
 * Re-timing moves the meal, **not** the entries inside it: an entry carries its
 * own `eaten_at` and `local_date`, which is what keeps a 23:50 entry on the
 * right local day.
 */
export async function editMeal(client: HasTransport, params: EditMealParams): Promise<DiaryMeal> {
  const response = await client.transport.request({
    method: "PATCH",
    path: `/v1/diary/meals/${encodeURIComponent(params.mealId)}`,
    body: {
      meal_name: params.mealName,
      eaten_at: params.eatenAt,
      local_date: params.localDate,
      timezone: params.timezone,
      flags: params.flags,
    },
    signal: params.signal,
  });
  return decodeDiaryMeal(response.body);
}

/** `DELETE /v1/diary/meals/{id}` — remove a meal and the entries in it. */
export async function deleteMeal(
  client: HasTransport,
  mealId: string,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<DeletionReceipt> {
  const response = await client.transport.request({
    method: "DELETE",
    path: `/v1/diary/meals/${encodeURIComponent(mealId)}`,
    signal: options?.signal,
  });
  return decodeDeletionReceipt(response.body);
}

export interface CopyParams {
  readonly targetDates: readonly string[];
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `POST /v1/diary/meals/{id}/copy` — copy a meal onto other local days.
 *
 * The copies keep the **original's** snapshot, so copying last Tuesday's
 * breakfast gives last Tuesday's food rather than today's version of it. Not
 * idempotent unless you pass an `Idempotency-Key`: copying twice gives the food
 * twice, which is what asking twice means.
 */
export async function copyMeal(
  client: HasTransport,
  mealId: string,
  params: CopyParams & { readonly idempotencyKey?: string | undefined },
): Promise<CopyResult> {
  const response = await client.transport.request({
    method: "POST",
    path: `/v1/diary/meals/${encodeURIComponent(mealId)}/copy`,
    body: { target_dates: params.targetDates, timezone: params.timezone },
    idempotencyKey: params.idempotencyKey,
    signal: params.signal,
  });
  return decodeCopyResult(response.body);
}

/** `POST /v1/diary/day/copy` — copy a whole local day onto others. */
export async function copyDay(
  client: HasTransport,
  params: CopyParams & { readonly localDate: string; readonly idempotencyKey?: string | undefined },
): Promise<CopyResult> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/diary/day/copy",
    body: {
      local_date: params.localDate,
      target_dates: params.targetDates,
      timezone: params.timezone,
    },
    idempotencyKey: params.idempotencyKey,
    signal: params.signal,
  });
  return decodeCopyResult(response.body);
}

/**
 * `DELETE /v1/diary/day` — remove everything on one local day.
 *
 * Clearing an already-empty day is a `200` with `entries_removed: 0`, not a
 * `404`: the end state you asked for is the state it is in.
 */
export async function clearDay(
  client: HasTransport,
  params: { readonly date: string; readonly signal?: AbortSignal | undefined },
): Promise<DeletionReceipt> {
  const response = await client.transport.request({
    method: "DELETE",
    path: "/v1/diary/day",
    query: { date: params.date },
    signal: params.signal,
  });
  return decodeDeletionReceipt(response.body);
}

/**
 * `GET /v1/diary/favourites` — the end user's starred foods.
 *
 * Each card carries enough to render a row without a second request: name,
 * brand, default serving and that serving's nutrition (DM-FR1). The card is a
 * copy for *rendering* and may be stale — `card_refreshed_at` says how stale.
 * Logging from a favourite refetches the food, so a stale card can never put
 * stale nutrition into a diary (DM-FR2).
 */
export async function listFavourites(
  client: HasTransport,
  options?: { readonly limit?: number | undefined; readonly signal?: AbortSignal | undefined },
): Promise<CardList> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/favourites",
    query: { limit: options?.limit },
    signal: options?.signal,
  });
  return decodeCardList(response.body);
}

/** `POST /v1/diary/favourites/{food_id}` — star a food. Starring twice is fine. */
export async function addFavourite(
  client: HasTransport,
  foodId: string,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<unknown> {
  const response = await client.transport.request({
    method: "POST",
    path: `/v1/diary/favourites/${encodeURIComponent(foodId)}`,
    signal: options?.signal,
  });
  return response.body;
}

/** `DELETE /v1/diary/favourites/{food_id}` — unstar a food. */
export async function removeFavourite(
  client: HasTransport,
  foodId: string,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<DeletionReceipt> {
  const response = await client.transport.request({
    method: "DELETE",
    path: `/v1/diary/favourites/${encodeURIComponent(foodId)}`,
    signal: options?.signal,
  });
  return decodeDeletionReceipt(response.body);
}

/**
 * `GET /v1/diary/recents` — the foods this end user logged most recently.
 *
 * Written by logging, not by a call of your own: there is no "add a recent".
 * De-duplicated by food with a `use_count`, ordered by last use, capped at 50
 * with the least recently used evicted (DM-FR3).
 */
export async function listRecents(
  client: HasTransport,
  options?: { readonly limit?: number | undefined; readonly signal?: AbortSignal | undefined },
): Promise<CardList> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/recents",
    query: { limit: options?.limit },
    signal: options?.signal,
  });
  return decodeCardList(response.body);
}

/**
 * `GET /v1/diary/foods/search` — search the end user's **own** foods.
 *
 * Deliberately not the provider search. Someone looking for their own "Mum's
 * lasagne" does not want two hundred lasagnes from the provider, and someone
 * searching the provider does not want their own drafts interleaved.
 *
 * Shorter than two characters is `400 query_too_short`.
 */
export async function searchOwnFoods(
  client: HasTransport,
  params: { readonly q: string; readonly limit?: number | undefined; readonly signal?: AbortSignal | undefined },
): Promise<unknown> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/foods/search",
    query: { q: params.q, limit: params.limit },
    signal: params.signal,
  });
  return response.body;
}

// ---------------------------------------------------------------------------
// Goals (0019): the daily targets the customer's app sets
// ---------------------------------------------------------------------------

export interface SetGoalParams {
  /**
   * The nutrient targets in the wire form: `{ energy: { value: 2200, unit:
   * "kcal" }, protein: { value: 120, unit: "g" } }`. Every key must be a
   * catalogue nutrient and every value a JSON number.
   */
  readonly targets: Readonly<Record<string, { readonly value: number | string; readonly unit?: string }>>;
  /** IANA zone. Decides which local day "from today forward" means. Required. */
  readonly timezone: string;
  /** Where the numbers came from. Omitted is recorded as `user_customised`. */
  readonly formulaVersion?: string | undefined;
  readonly inputs?: Readonly<Record<string, unknown>> | null | undefined;
  /** The day's water target in millilitres. Omitted or null means none in this version. */
  readonly waterMl?: number | null | undefined;
  /** The day's step target. Omitted or null means none in this version. */
  readonly steps?: number | null | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface GoalParams {
  /** `YYYY-MM-DD`. Omitted means today in `timezone`, which is then required. */
  readonly date?: string | undefined;
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `PUT /v1/diary/goal` — set the end user's daily targets.
 *
 * **You pass the values.** TrackCore computes no calorie or macro target from
 * a profile; it stores, versions and serves what your app sets. The effective
 * date is today in `timezone`, computed by the server, and nothing can
 * back-date a goal, so a past day's report never changes (DM-D1). A later
 * version without `waterMl` or `steps` clears them from that day forward.
 */
export async function setGoal(client: HasTransport, params: SetGoalParams): Promise<Goal> {
  const targets: Record<string, unknown> = {};
  for (const [code, target] of Object.entries(params.targets)) {
    targets[code] = { value: decimalOrNull(target.value), unit: target.unit };
  }
  const body: Record<string, unknown> = { targets, timezone: params.timezone };
  if (params.formulaVersion !== undefined) body["formula_version"] = params.formulaVersion;
  if (params.inputs !== undefined) body["inputs"] = params.inputs;
  if (params.waterMl !== undefined) body["water_ml"] = params.waterMl;
  if (params.steps !== undefined) body["steps"] = params.steps;
  const response = await client.transport.request({
    method: "PUT",
    path: "/v1/diary/goal",
    body,
    signal: params.signal,
  });
  return decodeGoal(response.body);
}

/**
 * `GET /v1/diary/goal` — the goal as it stood on a local date.
 *
 * A day before the end user ever set one is a `404 resource_not_found`
 * (`ResourceError`): the caller asked for a goal and there is none. `day`
 * reports the same situation as `goal_snapshot: null` with a reason, because
 * there it is a fact about the day.
 */
export async function getGoal(client: HasTransport, params: GoalParams = {}): Promise<Goal> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/diary/goal",
    query: { date: params.date, timezone: params.timezone },
    signal: params.signal,
  });
  return decodeGoal(response.body);
}
