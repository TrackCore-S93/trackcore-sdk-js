/**
 * `/v1/foods*` — the three read endpoints (T-026, T-027, T-028).
 *
 * Each is exported twice: as a standalone function taking the client, and as a
 * method on `client.foods`. The standalone form is the one that tree-shakes
 * (SDK-W5) — a customer importing `searchFoods` and nothing else does not ship
 * the batch read — and the method form is the one that reads well. They are the
 * same code; the methods delegate.
 *
 * # What is not here, and will not be
 *
 * No `scale`, no client-side portion arithmetic, no serving normalisation, no
 * nutrition summation (SDK-C2, DM-N10). Scaling a portion is `POST
 * /v1/foods/scale`, server-side, because the moment a client multiplies a
 * nutrient by a quantity there are two implementations of the product's core
 * promise and one of them is `grounds`'.
 *
 * No offline queue either (decided 2026-10-23): portion edits require the
 * network. The only caching here is ETag revalidation, which still asks the
 * server every time.
 */

import { ValidationError } from "../errors.js";
import { decodeBarcodeLookup, decodeBatchReadResult, decodeFood, decodeSearchResults } from "../decode.js";
import type { BarcodeLookup, BatchReadResult, Food, SearchResults } from "../models.js";
import type { Transport } from "../transport.js";

/** Anything carrying a transport. `TrackCore` satisfies it. */
export interface HasTransport {
  readonly transport: Transport;
}

/** P-021, which resolved C-7: the batch food read limit is 100, everywhere. */
export const BATCH_MAX_IDS = 100;

/** `q` is 2..200 characters, measured on the trimmed string, in code points. */
export const QUERY_MIN_LENGTH = 2;
export const QUERY_MAX_LENGTH = 200;

export interface SearchFoodsParams {
  /** Required, 2–200 characters. Shorter or longer is `400` from the server. */
  readonly q: string;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly region?: string | undefined;
  readonly language?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Opt in to ETag revalidation for this call. */
  readonly revalidate?: boolean | undefined;
}

/**
 * `GET /v1/foods/search` — keyword search (US-1, US-3, US-4, US-5, US-10).
 *
 * A search with no matches is a `200` with `results: []`, never an error: US-10
 * requires that an outage must never read as "no matches", so the two are
 * different responses and the empty page is the ordinary one. An outage is a
 * `502` and arrives as a `DependencyError`.
 *
 * `page_size` is clamped server-side and the **applied** size comes back in
 * `page_size`, with `page_size_clamped` saying so — a clamped value is reported,
 * never silently ignored.
 */
export async function searchFoods(client: HasTransport, params: SearchFoodsParams): Promise<SearchResults> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/foods/search",
    query: {
      q: params.q,
      page: params.page,
      page_size: params.pageSize,
      region: params.region,
      language: params.language,
    },
    signal: params.signal,
    revalidate: params.revalidate,
  });
  return decodeSearchResults(response.body);
}

export interface GetFoodOptions {
  readonly signal?: AbortSignal | undefined;
  readonly revalidate?: boolean | undefined;
}

/**
 * `GET /v1/foods/{food_id}` — one food (US-1, US-2, US-6).
 *
 * Throws `ResourceError` with code `food_gone` (410) when the provider no
 * longer resolves the id, and `resource_not_found` (404) when the string was
 * never a TrackCore food id at all. The server draws that line deliberately:
 * nothing went anywhere in the second case.
 */
export async function getFood(
  client: HasTransport,
  foodId: string,
  options: GetFoodOptions = {},
): Promise<Food> {
  if (typeof foodId !== "string" || foodId.trim() === "") {
    throw new ValidationError("foodId", "getFood: a food id is required");
  }
  const response = await client.transport.request({
    method: "GET",
    path: `/v1/foods/${encodeURIComponent(foodId)}`,
    signal: options.signal,
    revalidate: options.revalidate,
  });
  return decodeFood(response.body);
}

export interface BatchFoodsOptions {
  readonly signal?: AbortSignal | undefined;
  readonly revalidate?: boolean | undefined;
}

/**
 * `GET /v1/foods?ids=a,b,c` — up to {@link BATCH_MAX_IDS} foods in one call
 * (US-5, US-5b, edge case 7).
 *
 * One request in, one response out; the fan-out underneath is the server's
 * problem. That is the entire reason this endpoint exists — `grounds`' own
 * migration needed about 204 sequential calls per user and hand-rolled
 * chunk-of-10 throttling.
 *
 * Read `missing[]` before you act on `found[]`: every unresolvable id is in it,
 * in request order, and nothing is silently omitted.
 */
export async function batchFoods(
  client: HasTransport,
  ids: readonly string[],
  options: BatchFoodsOptions = {},
): Promise<BatchReadResult> {
  if (ids.length === 0) {
    throw new ValidationError("ids", "batchFoods: at least one food id is required");
  }
  // Checked here as well as on the server so that a loop over 500 favourites
  // fails at the call site, with the limit named, rather than after a round
  // trip. The server's `400 too_many_ids` remains the authority.
  if (ids.length > BATCH_MAX_IDS) {
    throw new ValidationError(
      "ids",
      `batchFoods: at most ${BATCH_MAX_IDS} ids may be requested in one call; ${ids.length} were given. ` +
        `Split the list into chunks of ${BATCH_MAX_IDS}.`,
    );
  }
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/foods",
    query: { ids: ids.join(",") },
    signal: options.signal,
    revalidate: options.revalidate,
  });
  return decodeBatchReadResult(response.body);
}

export interface LookupBarcodeOptions {
  readonly signal?: AbortSignal | undefined;
}

/**
 * `GET /v1/foods/barcode/{code}` — resolve a UPC or EAN on the server.
 *
 * A miss is a result, `status: "not_found"` and `food: null`, not a throw.
 * `invalid_barcode` is the throw, and it means the digits were rejected before
 * any provider was called.
 *
 * There is no camera method beside this. Scanning a code is a device
 * capability and does not belong in this package (SDK-W1, D-015).
 */
export async function lookupBarcode(
  client: HasTransport,
  code: string,
  options: LookupBarcodeOptions = {},
): Promise<BarcodeLookup> {
  if (typeof code !== "string" || code.trim() === "") {
    throw new ValidationError("code", "lookupBarcode: a barcode is required");
  }
  const response = await client.transport.request({
    method: "GET",
    path: `/v1/foods/barcode/${encodeURIComponent(code.trim())}`,
    signal: options.signal,
  });
  return decodeBarcodeLookup(response.body);
}
