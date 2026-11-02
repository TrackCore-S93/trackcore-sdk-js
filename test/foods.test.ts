/**
 * The three `/v1/foods*` endpoints, end to end through the client, over the
 * captured response bodies.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TrackCore } from "../src/client.js";
import { Decimal } from "../src/decimal.js";
import { ResourceError, ValidationError } from "../src/errors.js";
import { BATCH_MAX_IDS, batchFoods, getFood, lookupBarcode, searchFoods } from "../src/resources/foods.js";
import type { FetchLike } from "../src/transport.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;
const APPLE_ID = "tc_food_0H0MSKADSH7000000000000000";

function client(body: string, status = 200): { client: TrackCore; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    urls.push(url);
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => body,
    } as unknown as Response;
  };
  return { client: new TrackCore({ apiKey: SECRET, fetch: fetchImpl }), urls };
}

describe("search", () => {
  it("reads the captured search page", async () => {
    const { client: tc, urls } = client(fixture("search_apple.json"));
    const page = await tc.foods.search({ q: "apple", pageSize: 2 });

    expect(urls[0]).toBe("https://api.trackcore.dev/v1/foods/search?q=apple&page_size=2");
    expect(page.query).toBe("apple");
    // D-002 / P-007: the response says what kind of search ran, every time.
    expect(page.search_type).toBe("keyword");
    expect(page.page).toBe(0);
    expect(page.page_size).toBe(2);
    expect(page.page_size_clamped).toBe(false);
    expect(page.total_results).toBe(2003);
    expect(page.has_more).toBe(true);
    expect(page.results).toHaveLength(2);

    // Counters are numbers; nutrition is not.
    expect(typeof page.page_size).toBe("number");
    expect(page.results[0]?.servings[0]?.metric_amount).toBeInstanceOf(Decimal);
  });

  it("DM-F6: a search result is the same shape as a detail read", async () => {
    const page = (await client(fixture("search_apple.json")).client.foods.search({ q: "apple" }))
      .results[0];
    const detail = await client(fixture("food_detail.json")).client.foods.get(APPLE_ID);
    expect(page).toBeDefined();
    expect(Object.keys(page!).sort()).toEqual(Object.keys(detail).sort());
    // DM-S1: search results carry every serving, not a truncated list.
    expect(page!.servings).toHaveLength(detail.servings.length);
  });

  it("US-5: no matches is a 200 with an empty list, not an error", async () => {
    const { client: tc } = client(fixture("search_zero_results.json"));
    const page = await tc.foods.search({ q: "qqzzxxnomatchfood" });
    // US-10's requirement that an outage must never read as "no matches" is
    // this exact split: an empty page is an ordinary success.
    expect(page.results).toEqual([]);
    expect(page.total_results).toBe(0);
    expect(page.has_more).toBe(false);
  });

  it("US-10: an outage is a DependencyError, never an empty page", async () => {
    const { client: tc } = client(fixture("err_upstream_unavailable.json"), 502);
    await expect(tc.foods.search({ q: "apple" })).rejects.toMatchObject({
      code: "upstream_unavailable",
      isTransient: true,
    });
  });
});

describe("detail read", () => {
  it("reads one food", async () => {
    const { client: tc, urls } = client(fixture("food_detail.json"));
    const food = await tc.foods.get(APPLE_ID);
    expect(urls[0]).toBe(`https://api.trackcore.dev/v1/foods/${APPLE_ID}`);
    expect(food.food_id).toBe(APPLE_ID);
    expect(food.food_type).toBe("search_food");
    expect(food.name).toBe("Apples");
    expect(food.brand).toBeNull();
    expect(food.data_quality).toBe("ok");
    expect(food.servings).toHaveLength(5);
    expect(food.default_serving_id).toBe("fs:35718:32915");
    expect(food.provenance.source).toBe("fatsecret");
    expect(food.provenance.upstream_id).toBe("35718");
    expect(food.etag).toMatch(/^W\/"[0-9a-f]{32}"$/);
  });

  it("every key is present on every food (DM-F6), so no client checks for one", async () => {
    const { client: tc } = client(fixture("food_detail.json"));
    const food = await tc.foods.get(APPLE_ID);
    for (const key of [
      "food_id",
      "food_type",
      "name",
      "brand",
      "servings",
      "default_serving_id",
      "data_quality",
      "ingredients",
      "directions",
      "recipe_servings",
      "energy_reconciliation",
      "tolerance_version",
      "provenance",
      "updated_at",
      "etag",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(food, key), key).toBe(true);
    }
    // Null, not absent, and not a fabricated empty array.
    expect(food.ingredients).toBeNull();
    expect(food.recipe_servings).toBeNull();
  });

  it("410 food_gone is catchable as a ResourceError with its code", async () => {
    const { client: tc } = client(fixture("err_food_gone.json"), 410);
    let thrown: unknown;
    try {
      await tc.foods.get("tc_food_gone");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResourceError);
    expect((thrown as ResourceError).code).toBe("food_gone");
    expect((thrown as ResourceError).requestId).toBeTruthy();
  });

  it("encodes the id into the path", async () => {
    const { client: tc, urls } = client(fixture("food_detail.json"));
    await tc.foods.get("tc food/../x");
    expect(urls[0]).toBe("https://api.trackcore.dev/v1/foods/tc%20food%2F..%2Fx");
  });

  it("refuses an empty id at the call site", async () => {
    const { client: tc } = client("{}");
    await expect(tc.foods.get("")).rejects.toThrowError(ValidationError);
  });
});

describe("batch read", () => {
  it("US-5: unresolvable ids are listed in missing[], not silently omitted", async () => {
    const { client: tc, urls } = client(fixture("batch_found_missing.json"));
    const result = await tc.foods.batch([APPLE_ID, "tc_food_not_a_real_id", "tc_food_0H0RWKJE9S74WG000000000000"]);

    expect(urls[0]).toContain("/v1/foods?ids=");
    expect(result.found).toHaveLength(1);
    expect(result.found[0]?.food_id).toBe(APPLE_ID);
    expect(result.missing).toEqual([
      "tc_food_not_a_real_id",
      "tc_food_0H0RWKJE9S74WG000000000000",
    ]);
    // found + missing accounts for every id requested. Nothing vanishes.
    expect(result.found.length + result.missing.length).toBe(3);
  });

  it("a found food in a batch is the full canonical shape", async () => {
    const { client: tc } = client(fixture("batch_found_missing.json"));
    const result = await tc.foods.batch([APPLE_ID]);
    const food = result.found[0];
    expect(food?.servings).toHaveLength(5);
    expect(food?.servings[0]?.metric_amount?.toString()).toBe("138.000");
  });

  it("refuses more than the published limit before the round trip", async () => {
    const { client: tc, urls } = client("{}");
    const ids = Array.from({ length: BATCH_MAX_IDS + 1 }, (_, i) => `tc_food_${i}`);
    let thrown: unknown;
    try {
      await tc.foods.batch(ids);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as Error).message).toContain("100");
    expect(urls).toHaveLength(0);
  });

  it("accepts exactly the limit", async () => {
    const { client: tc } = client(fixture("batch_found_missing.json"));
    const ids = Array.from({ length: BATCH_MAX_IDS }, (_, i) => `tc_food_${i}`);
    await expect(tc.foods.batch(ids)).resolves.toBeDefined();
  });

  it("refuses an empty list", async () => {
    const { client: tc } = client("{}");
    await expect(tc.foods.batch([])).rejects.toThrowError(ValidationError);
  });
});

describe("the tree-shakeable functions are the same code", () => {
  it("searchFoods, getFood and batchFoods take the client", async () => {
    const { client: tc } = client(fixture("search_apple.json"));
    const viaFunction = await searchFoods(tc, { q: "apple", pageSize: 2 });
    const { client: tc2 } = client(fixture("search_apple.json"));
    const viaMethod = await tc2.foods.search({ q: "apple", pageSize: 2 });
    expect(JSON.stringify(viaFunction)).toBe(JSON.stringify(viaMethod));

    const { client: tc3 } = client(fixture("food_detail.json"));
    await expect(getFood(tc3, APPLE_ID)).resolves.toMatchObject({ name: "Apples" });

    const { client: tc4 } = client(fixture("batch_found_missing.json"));
    await expect(batchFoods(tc4, [APPLE_ID])).resolves.toMatchObject({ missing: expect.any(Array) });
  });
});

describe("barcode lookup", () => {
  const hit = JSON.stringify({
    barcode: "3017624010701",
    barcode_format: "EAN_13",
    status: "found",
    food: { servings: [{ metric_amount: 138.0 }] },
    resolved_by: "open_food_facts",
  }).replace("138", "138.000");

  it("keeps the decimal lexeme and does not throw on a miss", async () => {
    const { client: tc, urls } = client(hit);
    const found = await tc.barcode.lookup("3017624010701");
    expect(urls[0]).toBe("https://api.trackcore.dev/v1/foods/barcode/3017624010701");
    expect(found.status).toBe("found");
    expect(found.food?.servings[0]?.metric_amount).toEqual(new Decimal("138.000"));
    expect("scan" in tc.barcode).toBe(false);

    const miss = JSON.stringify({
      barcode: "96385074",
      barcode_format: "EAN_8",
      status: "not_found",
      food: null,
      resolved_by: null,
      suggestion_url: "/v1/foods/suggestions",
    });
    const { client: missed } = client(miss);
    const result = await missed.barcode.lookup("96385074");
    expect(result.status).toBe("not_found");
    expect(result.food).toBeNull();
    expect(result.suggestion_url).toBe("/v1/foods/suggestions");
  });

  it("surfaces invalid_barcode from the server", async () => {
    const { client: tc } = client(
      JSON.stringify({
        error: {
          code: "invalid_barcode",
          message: "The supplied barcode is not valid.",
          request_id: "req_test",
          docs_url: "https://trackcore.dev/docs/errors/invalid_barcode",
          retry_after_seconds: null,
        },
      }),
      400,
    );
    await expect(tc.barcode.lookup("abc")).rejects.toMatchObject({ code: "invalid_barcode" });
  });

  it("lookupBarcode is the same call as barcode.lookup", async () => {
    const { client: tc } = client(hit);
    await expect(lookupBarcode(tc, "3017624010701")).resolves.toMatchObject({ status: "found" });
  });
});

describe("healthz", () => {
  it("reads status and version", async () => {
    const { client: tc } = client('{"status":"ok","version":"0.1.0"}');
    await expect(tc.health()).resolves.toEqual({ status: "ok", version: "0.1.0" });
  });
});
