/**
 * ============================================================================
 * PLACEHOLDER MODELS — **every type in this file is to be replaced by T-107.**
 * ============================================================================
 *
 * T-107 generates the model layer from `contracts/openapi.yaml`, with a CI
 * parity gate, so that no SDK can drift from the API (SDK-C8) and a key is
 * never `carbs` in one SDK and `carbohydrate` in another (SDK-C9).
 * Hand-writing the real model layer here would guarantee two sources of truth
 * and one of them being wrong.
 *
 * What is here is the **minimum needed at the boundaries** so that the
 * transport, the error mapping and the example are type-safe and testable
 * today. Each interface has been reconciled field by field against the
 * published spec, and `test/spec-parity.test.ts` re-checks the key sets and
 * required lists against `contracts/openapi.yaml` on every run.
 *
 * **Names match the spec's schema names**, so the generator's output drops in
 * where these came out: `SearchResults`, not `SearchPage`; `BatchReadResult`,
 * not `BatchResult`; `CapabilityCatalogue`, not `CapabilityList`; `ProbeOk`,
 * not `Health`.
 *
 * ## The one thing the generator must preserve
 *
 * **Every field the spec flags `x-trackcore-decimal: true` is `Decimal` here,
 * never `number`.** That is the whole reason this SDK exists on the client
 * side; see `src/decimal.ts`. `contracts/README.md` says it plainly: no stock
 * generator maps `format: decimal` onto a decimal type, every one of them emits
 * the language's binary float, and for TypeScript the note is explicit —
 * "`JSON.parse` has already lost the value by the time your model sees it".
 *
 * The split is:
 *
 *   `Decimal`  every `Decimal` / `DecimalOrNull` in the spec — every nutrient
 *              value, every serving amount, every reconciliation figure
 *   `number`   the spec's `type: integer` fields: `page`, `page_size`,
 *              `total_results`, `serving_id_version`, `retry_after_seconds`,
 *              `limit`. Counters and indices, where a double is exact by
 *              construction and a `Decimal` would be noise
 *   `string`   `provenance.upstream_id`, which the spec calls out as the one
 *              deliberate exception: it is an identifier, not a quantity, and a
 *              leading zero on a GTIN is significant
 *
 * A generator that emits `number` for a nutrient has reintroduced the defect
 * the backend removed. `test/decimal-roundtrip.test.ts` is the gate.
 *
 * ## Sources
 *
 * | type                   | spec schema            | Go source |
 * |------------------------|------------------------|-----------|
 * | `Food`                 | `Food`                 | `services/nutrition/internal/food/food.go` |
 * | `Serving`              | `Serving`              | `services/nutrition/internal/servings/normaliser.go` |
 * | `NutritionDocument`    | `NutritionDocument`    | `services/nutrition/internal/nutrition/document.go` |
 * | `EnergyReconciliation` | `EnergyReconciliation` | `services/nutrition/internal/nutrition/energy.go` |
 * | `Provenance`           | `Provenance`           | `services/nutrition/internal/provenance/provenance.go` |
 * | `SearchResults`        | `SearchResults`        | `services/nutrition/internal/httpapi/foods.go` |
 * | `BatchReadResult`      | `BatchReadResult`      | `services/nutrition/internal/httpapi/foods.go` |
 * | `Capability`           | `Capability`           | `services/gateway/internal/capabilities/capabilities.go` |
 */

import type { Decimal } from "./decimal.js";

/**
 * `tc_food_` plus 26 characters of Crockford base32. Opaque to clients, and
 * stable across restarts and replicas — it is derived from the provider and the
 * provider's id rather than drawn at random, so a cached id still resolves
 * after a deploy.
 *
 * A branded alias rather than a `string` subtype: the spec publishes a pattern,
 * but validating it client-side would be the defensive parsing SDK-C2 bans.
 */
export type FoodId = string;

/**
 * `fs:3391:12345`, and deliberately **not** opaque — data-model.md §2 publishes
 * the form literally. Two other forms exist: a hash-keyed id where the provider
 * gave none (`fs:3391:pa1b2c3d4e5f6`), and a synthesised one carrying its
 * portion (`fs:35718:synth:100g`).
 */
export type ServingId = string;

/** data-model.md §3. All four return the same JSON shape (DM-F6). */
export type FoodType = "search_food" | "custom_food" | "recipe" | "scan_food";

/**
 * How usable this food's serving data is.
 *
 * `"partial"` — servings exist but none is metric and none can be synthesised
 * honestly — is **a real state in live data that no PRD names**. Four servings
 * in the captured fixtures land there. Handle all three.
 */
export type DataQuality = "ok" | "partial" | "unusable";

/** DM-N4 / P-017. TrackCore never *derives* `"net"`; a provider must state it. */
export type CarbohydrateBasis = "total" | "net";

/** DM-N3 / P-022. The regulatory label units. **IU is never returned.** */
export type NutrientUnit = "g" | "kcal" | "mcg" | "mg";

/** The provider a food is attributed to. `computed` is legal for a *field*, never the object. */
export type ProvenanceSource = "fatsecret" | "open_food_facts" | "usda" | "cnf";

/** RFC 3339 in UTC, to whole seconds, always with a literal `Z`. */
export type Timestamp = string;

/**
 * One nutrient.
 *
 * `null` at this position is DM-N2's third state: the nutrient is modelled, and
 * the provider gave no value. It is **not** zero, and the SDK will never turn
 * it into one. A key absent entirely means the nutrient is not modelled on this
 * food at all (DM-N8).
 *
 * The spec splits this into one schema per unit (`NutrientValueGram`,
 * `NutrientValueKcal`, …) with `unit` as a `const` and `basis` **required** on
 * carbohydrate. T-107's generated version will have that discrimination; this
 * is the flattened placeholder, which is structurally compatible and looser.
 */
export interface NutrientValue {
  /** Exact. Flagged `x-trackcore-decimal` in the spec. See `src/decimal.ts`. */
  readonly value: Decimal;
  /** Fixed per nutrient by the catalogue, never carried per value. */
  readonly unit: NutrientUnit;
  /** Present on `carbohydrate`, and always present there (DM-N4). */
  readonly basis?: CarbohydrateBasis;
}

/**
 * Absolute nutrition for `base_quantity` of the serving that carries it — **not
 * per-100 g values**.
 *
 * Indexed rather than enumerated because the nutrient set is not frozen: OQ-8
 * is open, T-128 is blocked on it, and every catalogue row in the spec is
 * status `candidate`. T-107's generated version will have the named keys; until
 * then, `noUncheckedIndexedAccess` makes an unknown key `| undefined`, which is
 * DM-N8's "absent" and is correctly distinct from `null`.
 */
export type NutritionDocument = Readonly<Record<string, NutrientValue | null>>;

/** Why an `EnergyReconciliation` looks the way it does. A closed set. */
export type ReconciliationReason =
  | "compared"
  | "insufficient_macros"
  | "energy_computed"
  | "provider_energy_zero_with_macros"
  | "no_energy_available";

/** The scale the flag comparison was made at. */
export type ReconciliationBasis = "per_100g" | "per_100ml" | "as_provided";

/**
 * Energy reconciled server-side (DM-N5 / P-016).
 *
 * **The provider's energy always wins.** The Atwater figure is returned beside
 * it, never instead of it. So the tolerance can change how often a food is
 * *flagged* and can never change a number an end user sees.
 */
export interface EnergyReconciliation {
  readonly provider_value: Decimal | null;
  readonly computed_value: Decimal | null;
  readonly variance_pct: Decimal | null;
  readonly flagged: boolean;
  /** `v1` is ±5 % or ±10 kcal — **provisional pending OQ-13**. */
  readonly tolerance_version: string;
  readonly reason: ReconciliationReason;
  /** **Absent** where there is no energy at all. Distinct from either value. */
  readonly energy_source?: "provider" | "computed";
  readonly basis: ReconciliationBasis;
  /** Which serving this was taken from. Absent only on a food with no servings. */
  readonly basis_serving_id?: ServingId;
}

export interface Provenance {
  readonly source: ProvenanceSource;
  /**
   * **A string, deliberately**, even when it looks like a number (`"35718"`).
   * The spec names this the one documented exception to "numeric-looking values
   * are JSON numbers": it is an identifier, and rendering it as a number would
   * drop the leading zero from a GTIN and change which product it names.
   */
  readonly upstream_id: string;
  /** DM-P1 requires it; it is `null` on every food today. A known gap. */
  readonly upstream_version: string | null;
  readonly snapshot_at: Timestamp;
  /**
   * Present on every AI-derived food and **absent — not `null`, and certainly
   * not `0`** — on a deterministic read (DM-P4). A `null` would say "we have a
   * confidence and it is unknown"; a `0` would say "we are certain it is
   * wrong". Nothing this service produces is AI-derived.
   */
  readonly confidence?: Decimal;
  /** Per-field provenance (DM-P2 / DM-P3). `{}` where nothing was computed. */
  readonly fields: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * One portion option, carrying the **absolute nutrition for `base_quantity` of
 * it**. Every food read returns every serving (DM-S1); the one exception is a
 * food whose `data_quality` is `unusable`, which returns `servings: []`.
 */
export interface Serving {
  readonly serving_id: ServingId;
  /** Always `1` today: re-issue detection needs the food cache (T-025). */
  readonly serving_id_version: number;
  readonly description: string;
  /** `null` on a metric serving, and `null` when one unit's weight is unknown. */
  readonly household_unit: string | null;
  /**
   * **How many of this serving the serving's own `nutrition` describes** — a
   * different field in a different object from the diary's `consumed_quantity`,
   * and the two may never be merged (DM-S6). Never null: the spec types this
   * `Decimal`, not `DecimalOrNull`.
   */
  readonly base_quantity: Decimal;
  readonly metric_amount: Decimal | null;
  /** `g` or `ml` and nothing else. A unit TrackCore cannot name is not assumed to be grams. */
  readonly metric_unit: "g" | "ml" | null;
  /** The weight of **one** household unit (DM-S4), so a `2 cookies` 60 g serving reports 30. */
  readonly gram_weight_per_household_unit: Decimal | null;
  readonly is_metric_default: boolean;
  /**
   * `true` where TrackCore created this serving rather than receiving it.
   * 25 of the 44 foods in the captured fixtures need this, so it is the common
   * path, not an edge case. `provenance.fields` carries the rule and the donor.
   */
  readonly is_synthesised: boolean;
  readonly nutrition: NutritionDocument;
}

/**
 * DM-F6: all four `food_type` values return the **same JSON shape**. One parser
 * serves search, barcode, NLP, image recognition and label scan results, and
 * every key is present on every food — a client that has to check which keys
 * exist is a client writing the defensive parsing TrackCore exists to delete.
 */
export interface Food {
  readonly food_id: FoodId;
  readonly food_type: FoodType;
  readonly name: string;
  /** `null` for an unbranded food. Upstream sends `""`; that is absence. */
  readonly brand: string | null;
  readonly servings: readonly Serving[];
  /** A hint for which serving to preselect. Never a restriction (DM-S1). */
  readonly default_serving_id: ServingId | null;
  readonly data_quality: DataQuality;
  readonly ingredients: readonly Readonly<Record<string, unknown>>[] | null;
  readonly directions: readonly string[] | null;
  readonly recipe_servings: Decimal | null;
  /** `null` only for a food with no servings at all. */
  readonly energy_reconciliation: EnergyReconciliation | null;
  readonly tolerance_version: string | null;
  readonly provenance: Provenance;
  /** Until T-025 lands this is the snapshot time of *this read*, so it moves every request. */
  readonly updated_at: Timestamp;
  /** Weak validator, `W/"…"`. Pass it to `If-None-Match`; see `src/cache.ts`. */
  readonly etag: string;
}

/** `GET /v1/foods/search`. */
export interface SearchResults {
  readonly query: string;
  /**
   * D-002 / P-007: keyword matching, not meaning matching. The word "semantic"
   * appears on no customer-facing surface of this API, enforced by a CI check.
   */
  readonly search_type: "keyword";
  readonly page: number;
  /** The size **actually applied**, after clamping. Never silently ignored. */
  readonly page_size: number;
  /** Asking for nothing and getting the default is **not** a clamp. */
  readonly page_size_clamped: boolean;
  /** **`null` where the provider gave none.** A missing total is not zero. */
  readonly total_results: number | null;
  readonly has_more: boolean;
  /** Empty on a query that matched nothing — a 200, never the answer to an outage. */
  readonly results: readonly Food[];
}

/**
 * `GET /v1/foods?ids=a,b,c`.
 *
 * `missing` is in request order and holds **every** unresolvable id — US-5:
 * "unresolvable ones are listed in `missing[]` (not silently omitted)".
 *
 * An id is there because it is genuinely unresolvable, and **never** because a
 * lookup failed transiently; that is a `502` for the whole request. That split
 * is deliberate on the server, and it is what makes it safe to act on this
 * array — dropping a favourite, pruning a cache — which you could not do if an
 * outage could put an id in it.
 */
export interface BatchReadResult {
  readonly found: readonly Food[];
  readonly missing: readonly string[];
}

/** `GET /v1/capabilities` (PF-A2). Every capability, Coming Soon ones included. */
export interface Capability {
  /** The scope name used in an `entitlement_required` body, e.g. `nutrition.search`. */
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** `coming_soon` rows are listed and are neither selectable nor billable. */
  readonly availability: "v1" | "coming_soon" | "retired";
  readonly selectable: boolean;
  readonly billable: boolean;
  readonly requires_entitlement: boolean;
  /** Which capability's meter this one's calls land on, where not itself (PF-E5). */
  readonly billed_as: string | null;
  readonly requires_dpa: boolean;
  readonly cost_class: string;
}

export interface CapabilityCatalogue {
  /** PF-K5: a test credential is served by the same code path and marked here. */
  readonly environment: "live" | "test";
  readonly capabilities: readonly Capability[];
}

/** The symbology a barcode was accepted as. */
export type BarcodeFormat = "UPC_A" | "UPC_E" | "EAN_8" | "EAN_13";

/** `found` resolved a food. `not_found` is a successful response, not an error. */
export type BarcodeStatus = "found" | "not_found";

/**
 * `GET /v1/foods/barcode/{code}`.
 *
 * A miss is this object with `status: "not_found"` and `food: null`. It does
 * not throw. `invalid_barcode` is the error, and it means the digits never
 * reached a provider.
 */
export interface BarcodeLookup {
  /** The digits the caller sent. A UPC-E is echoed as submitted. */
  readonly barcode: string;
  readonly barcode_format: BarcodeFormat;
  readonly status: BarcodeStatus;
  /** `food_type` is `scan_food` on a hit. `null` on a miss. */
  readonly food: Food | null;
  /** Which provider resolved the food. `null` on a miss. */
  readonly resolved_by: "fatsecret" | "open_food_facts" | null;
  /** Present on a miss: where a customer can submit the unresolved code. */
  readonly suggestion_url?: string;
}

/** `GET /healthz` and `GET /readyz`. Liveness only; it touches nothing. */
export interface ProbeOk {
  readonly status: "ok";
  readonly version: string;
}

/**
 * How one spoken item was resolved (`POST /v1/nlp`).
 *
 * `matched`: the spoken quantity and unit named one of the food's servings,
 * or a measure it could be scaled to. `default_serving`: the food was found
 * and nothing usable was spoken, so the default serving and a quantity of 1
 * stand in. `no_serving`: the food publishes no serving to log. `no_match`:
 * the catalogue has nothing for the phrase.
 */
export type NlpItemStatus = "matched" | "default_serving" | "no_serving" | "no_match";

/**
 * One food a sentence named, resolved against the catalogue.
 *
 * `phrase`, `quantity` and `unit` are what was said, as the language model
 * read them. Everything else is the catalogue's and the serving arithmetic's:
 * the model never produces a nutrient, and `consumed_nutrition` is the same
 * figure the diary will store when the item is logged.
 */
export interface NlpItem {
  /** The user's words for this food, as spoken. */
  readonly phrase: string;
  /** How many, when a number was said; `null` when none was. */
  readonly quantity: Decimal | null;
  /** The measure, lower-cased, when one was said: `g`, `ml`, `oz`, `cup`, `slice`, …; `null` when none was. */
  readonly unit: string | null;
  readonly status: NlpItemStatus;
  /** The catalogue's top match. `null` on `no_match`. */
  readonly food: Food | null;
  /** The serving chosen, one of `food.servings[].serving_id`. `null` unless a serving was chosen. */
  readonly serving_id: ServingId | null;
  /**
   * How many of the chosen serving, in the diary's convention: what
   * `diary.log` takes as `consumedQuantity`. On a metric serving it is the
   * amount in that unit, so "150 g" of a per-100 g serving is `150`.
   */
  readonly consumed_quantity: Decimal | null;
  /** The nutrition for `consumed_quantity` of the chosen serving, computed on the server. */
  readonly consumed_nutrition: NutritionDocument | null;
}

/**
 * `POST /v1/nlp`: one sentence about food, resolved.
 *
 * `items` is the sentence split and resolved, in the order spoken. `results`
 * is the matched foods, each once, in item order; when the gateway could not
 * split the sentence it is one ten-food search of the whole text and `items`
 * is empty.
 */
export interface NlpResult {
  /** The transcript after trimming. Empty when nothing was said. */
  readonly text: string;
  readonly items: readonly NlpItem[];
  readonly query: string;
  readonly search_type: "keyword";
  readonly page: number;
  readonly page_size: number;
  readonly page_size_clamped: boolean;
  readonly total_results: number | null;
  readonly has_more: boolean;
  readonly results: readonly Food[];
}

// ---------------------------------------------------------------------------
// Diary (T-096 … T-105), custom foods and sessions (T-126)
//
// Placeholders like everything above, and replaced by T-107 the same way. The
// field names are the spec's; `Decimal` appears wherever a nutrient value or a
// quantity does, for the same reason it does on `Food`.
// ---------------------------------------------------------------------------

/** A nutrient total plus whether anything was left out of it. */
export interface DailyNutrition {
  readonly app_user: string;
  readonly local_date: string;
  readonly timezone: string;
  /**
   * How many logged foods the totals came from. Zero consumption and "no
   * entries" produce the same numbers, and a client showing a day needs to tell
   * them apart.
   */
  readonly entries: number;
  readonly consumed: NutritionDocument;
  /**
   * The goal in force on that date, or `null`. Always `null` today: goals are
   * not yet settable. Never `{}` and never back-dated (DM-D4).
   */
  readonly goal_snapshot: Readonly<Record<string, unknown>> | null;
  /** Why `goal_snapshot` is null. Absent when a goal is present. */
  readonly goal_snapshot_reason?: "no_goal_in_force";
  /** The goal minus the consumption, or `null` when there is no goal. */
  readonly remaining: Readonly<Record<string, unknown>> | null;
  /**
   * `true` when a nutrient in `consumed` had a contributing food that reported
   * `null`, or that does not model it at all (DM-M4). The total is still the
   * best available number; this says it is not a complete one.
   */
  readonly partial_sum: boolean;
  readonly environment: "test" | "live";
}

/** A logged food as a day list renders it — no `food_snapshot`. */
export interface DiaryMealEntry {
  readonly entry_id: string;
  readonly food_id: string;
  readonly food_type: FoodType;
  readonly name: string;
  readonly brand: string | null;
  readonly position: number;
  readonly source: string;
  readonly selected_serving_id: ServingId;
  readonly modified_serving: Readonly<Record<string, unknown>> | null;
  readonly serving_description: string;
  readonly consumed_quantity: Decimal;
  readonly nutrition: NutritionDocument;
  readonly partial_sum: boolean;
  readonly eaten_at: Timestamp;
  readonly logged_at: Timestamp;
  readonly updated_at: Timestamp;
}

/** DM-M3's flags. */
export interface MealFlags {
  readonly eaten: boolean;
  readonly custom: boolean;
  readonly treat: boolean;
  readonly social: boolean;
}

/** A meal: a name plus a timestamp, not a fixed daypart (DM-M1). */
export interface DiaryMeal {
  readonly meal_id: string;
  readonly meal_name: string;
  readonly external_id?: string;
  readonly eaten_at: Timestamp;
  readonly local_date?: string;
  readonly timezone?: string;
  readonly flags: MealFlags;
  /** `true` when this merged into a meal already in that minute (DM-M1). */
  readonly merged?: boolean;
  readonly entries?: readonly DiaryMealEntry[];
  readonly nutrition_total?: NutritionDocument;
  readonly partial_sum?: boolean;
  readonly environment?: "test" | "live";
}

export interface DiaryMeals {
  readonly app_user: string;
  readonly local_date: string;
  readonly timezone: string;
  readonly meals: readonly DiaryMeal[];
  readonly environment: "test" | "live";
}

export interface DiaryRangeDay {
  readonly local_date: string;
  readonly timezone: string;
  readonly entries: number;
  readonly consumed: NutritionDocument;
  readonly partial_sum: boolean;
}

export interface DiaryRange {
  readonly app_user: string;
  readonly from: string;
  readonly to: string;
  /** Every day in the span, including the empty ones, zeroed (DM-D4). */
  readonly days: readonly DiaryRangeDay[];
  readonly environment: "test" | "live";
}

/** A logged food as a write returns it — with the whole snapshot (P-002). */
export interface LoggedFood {
  readonly entry_id: string;
  readonly meal_id: string;
  readonly meal_name: string;
  readonly external_id: string;
  readonly food_id: FoodId;
  readonly food_type: FoodType;
  readonly source: string;
  readonly position: number;
  readonly selected_serving_id: ServingId;
  readonly modified_serving: Readonly<Record<string, unknown>> | null;
  /** Never merged with `serving.base_quantity` (P-004). */
  readonly consumed_quantity: Decimal;
  readonly serving: Serving;
  readonly nutrition: NutritionDocument;
  /** The whole food, every serving, as it was when logged. */
  readonly food_snapshot: Food;
  readonly snapshot_state: string;
  readonly eaten_at: Timestamp;
  readonly local_date: string;
  readonly timezone: string;
  readonly logged_at: Timestamp;
  readonly updated_at: Timestamp;
  readonly environment: "test" | "live";
}

/**
 * A favourite or recent, denormalised enough to render without a second
 * request (DM-FR1).
 */
export interface Card {
  readonly food_id: FoodId;
  readonly name: string;
  readonly brand: string | null;
  readonly default_serving_id: ServingId;
  readonly serving_description: string;
  readonly nutrition: NutritionDocument | null;
  /** Recents only. */
  readonly last_used_at?: Timestamp;
  readonly use_count?: number;
  /** Favourites only. */
  readonly favourited_at?: Timestamp;
  /** When the card was taken. A card may be stale; a snapshot never is. */
  readonly card_refreshed_at?: Timestamp;
}

export interface CardList {
  readonly external_id: string;
  readonly cards: readonly Card[];
  readonly environment: "test" | "live";
}

export interface DeletionReceipt {
  readonly external_id: string;
  readonly deleted: boolean;
  readonly entries_removed?: number;
  readonly food_id?: string;
  readonly environment: "test" | "live";
}

export interface ReorderResult {
  readonly external_id: string;
  readonly meal_id: string;
  readonly entry_ids: readonly string[];
  readonly environment: "test" | "live";
}

export interface CopyResult {
  readonly external_id: string;
  readonly meals: readonly DiaryMeal[];
  readonly target_dates: readonly string[];
  readonly source: { readonly meal_id?: string; readonly local_date?: string };
  readonly environment: "test" | "live";
}

/**
 * An end-user session token. The value appears in this response and nowhere
 * else, ever — there is no endpoint that reads one back.
 */
export interface SessionToken {
  readonly session_token: string;
  readonly external_id: string;
  readonly expires_at: Timestamp;
  readonly issued_at: Timestamp;
  readonly ttl_seconds: number;
  readonly environment: "test" | "live";
  /** `opaque`. Not a JWT: there is nothing in it to decode. */
  readonly token_type: string;
}

/**
 * `DELETE /v1/users/{external_id}` (PF-T5). `deleted` is rows removed per
 * table; its key set is the server's erasure registry, not a fixed list, so it
 * grows when a table is added. `replayed` is true when this is an earlier
 * erasure's receipt, returned because the end user no longer exists.
 */
export interface ErasureReceipt {
  readonly external_id: string;
  readonly status: "completed";
  readonly requested_at: Timestamp;
  readonly completed_at: Timestamp;
  readonly deleted: Readonly<Record<string, number>>;
  readonly replayed: boolean;
  readonly request_id: string;
  readonly environment: "test" | "live";
}
