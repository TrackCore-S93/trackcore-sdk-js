#!/usr/bin/env node
/**
 * TrackCore JavaScript SDK — runnable quickstart (T-117, SDK-C10).
 *
 *   node examples/quickstart.mjs
 *
 * By default it runs against a **local stub** built from the captured responses
 * in `test/fixtures/`, so it works with no key, no network and no running
 * backend. Point it at a real deployment with:
 *
 *   TRACKCORE_API_KEY=tc_sk_live_… TRACKCORE_BASE_URL=https://api.trackcore.dev \
 *     node examples/quickstart.mjs --live
 *
 * It covers: create a client → search → read one food → handle a `missing[]`
 * entry → catch a typed error.
 *
 * The diary half of SDK-C10's "search → select serving → log → read the day" is
 * not here, because `/v1/diary` is not built yet. The serving-selection step is
 * — and note what it does *not* do: it reads the serving's nutrition straight
 * off the response. It never multiplies anything. Scaling a portion is
 * `POST /v1/foods/scale`, server-side (SDK-C2, DM-N10).
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TrackCore,
  MemoryResponseCache,
  isAPIError,
  isErrorOfCode,
  MaintenanceError,
  RateLimitError,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes("--live");

// --------------------------------------------------------------------------
// 1. Create a client
// --------------------------------------------------------------------------

const client = new TrackCore({
  // A secret key here is fine: this is Node. The same line in a browser bundle
  // throws `ConfigurationError` with reason "secret_key_in_browser" before any
  // request is sent. Use `tc_pk_…` in client code.
  apiKey: live ? process.env.TRACKCORE_API_KEY : DEMO_KEY(),
  ...(live ? {} : { fetch: stubFetch() }),
  // ETag revalidation. Still asks the server every time; a 304 just means the
  // body you already have is still correct. There is no offline mode.
  cache: new MemoryResponseCache(),
  onDiagnostic: (d) => {
    if (d.event === "retry") console.log(`   … retrying (${d.reason}) in ${d.delayMs} ms`);
  },
});

console.log(`client: ${client.describeCredential()}  environment: ${client.environment}\n`);

// --------------------------------------------------------------------------
// 2. Search
// --------------------------------------------------------------------------

const page = await client.foods.search({ q: "apple", pageSize: 2, revalidate: true });

console.log(`search "${page.query}" (${page.search_type})`);
console.log(`  page ${page.page}, size ${page.page_size}, ${page.total_results ?? "?"} total, more: ${page.has_more}`);
for (const food of page.results) {
  console.log(`  - ${food.food_id}  ${food.name}${food.brand ? ` (${food.brand})` : ""}`);
}

if (page.results.length === 0) {
  // US-5: no matches is a 200 with an empty list. An outage is a 502 and
  // arrives as a DependencyError — the two are never confused (US-10).
  console.log("  (no matches — this is a success, not an error)");
}

// --------------------------------------------------------------------------
// 3. Read one food, and look at a serving
// --------------------------------------------------------------------------

const food = await client.foods.get(page.results[0].food_id, { revalidate: true });

console.log(`\n${food.name} — ${food.servings.length} servings, data_quality: ${food.data_quality}`);

const chosen = food.servings.find((s) => s.serving_id === food.default_serving_id) ?? food.servings[0];
console.log(`  serving: ${chosen.description}`);
console.log(`  metric:  ${chosen.metric_amount} ${chosen.metric_unit}`);

// **This is the point of the whole SDK.** `metric_amount` prints as `138.000`,
// not `138`: the value carries the exact lexeme the server sent, not a double.
console.log(`  exact?   "${chosen.metric_amount}" (scale ${chosen.metric_amount.scale})`);
console.log(`  as a double, for arithmetic you accept is approximate: ${chosen.metric_amount.toNumber()}`);

for (const code of ["energy", "protein", "carbohydrate", "fat", "saturated_fat", "vitamin_d"]) {
  const nutrient = chosen.nutrition[code];
  // DM-N2: null means the provider gave no value. It is NOT zero, and the SDK
  // will never turn it into one.
  console.log(`  ${code.padEnd(14)} ${nutrient === null ? "— (not reported)" : `${nutrient.value} ${nutrient.unit}`}`);
}

// --------------------------------------------------------------------------
// 4. Batch read, and handling a missing[] entry
// --------------------------------------------------------------------------

const requested = [food.food_id, "tc_food_not_a_real_id", "tc_food_0H0RWKJE9S74WG000000000000"];
const batch = await client.foods.batch(requested);

console.log(`\nbatch: asked for ${requested.length}, got ${batch.found.length} back`);
for (const id of batch.missing) {
  // An id is in `missing[]` when it is **unresolvable**, and for no other
  // reason. A transient upstream failure never lands here — it becomes a 502
  // for the whole call. That is what makes it safe to act on this list:
  // dropping a favourite, pruning a cache. An outage must never read as an
  // absence (US-10).
  console.log(`  missing: ${id} — unresolvable; safe to drop from a saved list`);
}

// --------------------------------------------------------------------------
// 5. Typed errors
// --------------------------------------------------------------------------

try {
  await client.foods.get("tc_food_0H0RWKJE9S74WG000000000000");
} catch (error) {
  if (isErrorOfCode(error, "food_gone")) {
    console.log(`\nfood_gone (${error.status}): ${error.message}`);
    console.log(`  request_id: ${error.requestId}`);
    console.log(`  docs:       ${error.docsUrl}`);
  } else if (error instanceof MaintenanceError) {
    // 503 is the ONLY maintenance signal (P-020): we turned it off on purpose.
    // Show a banner, retry after `error.retryAfterSeconds`.
    console.log(`maintenance: ${error.fields.capability}, back in ${error.retryAfterSeconds}s`);
  } else if (error instanceof RateLimitError) {
    console.log(`rate limited; retry after ${error.retryAfterSeconds}s`);
  } else if (isAPIError(error)) {
    console.log(`${error.code} (${error.status}): ${error.message}`);
  } else {
    throw error;
  }
}

console.log("\ndone.");

// --------------------------------------------------------------------------
// The local stub. Not part of the SDK; it just replays captured responses so
// this file runs with no backend.
// --------------------------------------------------------------------------

function DEMO_KEY() {
  // Not a credential: 43 base62 characters that parse as a test publishable
  // key and were never issued by anything.
  return "tc_pk_test_0000000000000000000000000000000000DEMO00";
}

function stubFetch() {
  const fixture = (name) => readFileSync(join(here, "..", "test", "fixtures", name), "utf8");
  return async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    const reply = (status, body) =>
      new Response(body, { status, headers: { "Content-Type": "application/json", "X-Request-Id": "req_stub" } });

    if (path.startsWith("/v1/foods/search")) return reply(200, fixture("search_apple.json"));
    if (path.startsWith("/v1/foods?ids=")) return reply(200, fixture("batch_found_missing.json"));
    if (path.startsWith("/v1/foods/tc_food_0H0RWKJE9S74WG")) return reply(410, fixture("err_food_gone.json"));
    if (path.startsWith("/v1/foods/")) return reply(200, fixture("food_detail.json"));
    return reply(404, fixture("err_food_gone.json"));
  };
}
