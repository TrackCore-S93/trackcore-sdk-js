/**
 * **The test this SDK exists for.**
 *
 * Every assertion here runs over `test/fixtures/food_detail.json`, which is not
 * a mock. It is the byte-for-byte body that
 * `services/nutrition/internal/httpapi` wrote when the real detail handler was
 * driven over the real captured `food-api` response for food 35718 (Apples).
 * The numbers in it are the ones FatSecret actually sent, normalised by the
 * real normalisation stack.
 *
 * The first block demonstrates the failure. The rest proves the fix.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Decimal } from "../src/decimal.js";
import { parseJson, parseStrict } from "../src/json.js";
import { decodeFood } from "../src/decode.js";
import type { Food, NutrientValue } from "../src/models.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const detailText = readFileSync(join(FIXTURES, "food_detail.json"), "utf8");

/** Pulls a nutrient off a serving, asserting it is present rather than null. */
function nutrient(food: Food, servingIndex: number, code: string): NutrientValue {
  const serving = food.servings[servingIndex];
  if (serving === undefined) throw new Error(`no serving at index ${servingIndex}`);
  const value = serving.nutrition[code];
  if (value === null || value === undefined) throw new Error(`${code} is null on serving ${servingIndex}`);
  return value;
}

describe("the hazard: what JSON.parse does to a TrackCore response", () => {
  it("silently destroys the precision the backend went to trouble to preserve", () => {
    // Not a hypothetical. These are the lexemes in the captured body.
    expect(detailText).toContain('"metric_amount":138.000');
    expect(detailText).toContain('"saturated_fat":{"value":0.039');
    expect(detailText).toContain('"gram_weight_per_household_unit":138.0000000000000000');

    const naive = JSON.parse(detailText) as {
      servings: { metric_amount: number; gram_weight_per_household_unit: number }[];
    };
    const first = naive.servings[0];
    if (first === undefined) throw new Error("fixture has no servings");

    // The scale is gone. `138.000` is a figure reported to three decimal
    // places; `138` is not the same statement about the world.
    expect(String(first.metric_amount)).toBe("138");
    expect(String(first.gram_weight_per_household_unit)).toBe("138");

    // And the values that survive as strings are not exact as *values*. 19.06
    // is not representable in binary64, so arithmetic on it drifts.
    expect(19.06 * 3).not.toBe(57.18);
    expect(19.06 + 19.06 + 19.06).not.toBe(57.18);

    // The compounding failure, with this response's own numbers. Binary64
    // addition is not associative, so summing the five servings' carbohydrate
    // forwards and backwards gives two different answers. Two clients that
    // total a user's day in different orders would disagree about it — and
    // neither would be able to say which one was wrong.
    const carbs = naive.servings.map(
      (s) => (s as unknown as { nutrition: Record<string, { value: number }> }).nutrition["carbohydrate"]!.value,
    );
    expect(carbs).toEqual([19.06, 13.81, 14.64, 29.28, 3.92]);
    const forwards = carbs.reduce((a, b) => a + b, 0);
    const backwards = [...carbs].reverse().reduce((a, b) => a + b, 0);
    expect(forwards).not.toBe(backwards);
    expect(forwards.toPrecision(20)).toBe("80.709999999999993747");
    expect(backwards.toPrecision(20)).toBe("80.710000000000007958");
  });
});

describe("the fix: every lexeme survives the SDK's parser", () => {
  it("round-trips 138.000, 0.039 and 19.06 exactly", () => {
    const food = decodeFood(parseJson(detailText));

    const medium = food.servings[0];
    if (medium === undefined) throw new Error("fixture has no servings");
    expect(medium.description).toBe('medium (2-3/4" dia) (approx 3 per lb)');

    // The three the brief names, exactly as written on the wire.
    expect(medium.metric_amount?.toString()).toBe("138.000");
    expect(nutrient(food, 0, "saturated_fat").value.toString()).toBe("0.039");
    expect(nutrient(food, 0, "carbohydrate").value.toString()).toBe("19.06");

    // And the one that would be most spectacularly lost.
    expect(medium.gram_weight_per_household_unit?.toString()).toBe("138.0000000000000000");

    // Scale is preserved as written, which is the information `JSON.parse`
    // throws away first.
    expect(medium.metric_amount?.scale).toBe(3);
    expect(medium.gram_weight_per_household_unit?.scale).toBe(16);
  });

  it("preserves trailing zeros across every serving in the real response", () => {
    const food = decodeFood(parseJson(detailText));
    const amounts = food.servings.map((s) => s.metric_amount?.toString());
    // Captured from the live normalisation stack: five servings, every one with
    // the provider's three decimal places intact.
    expect(amounts).toEqual(["138.000", "100.000", "106.000", "212.000", "28.350"]);
  });

  it("every number in the document re-renders to the substring it came from", () => {
    // The strong form of the claim: not "the ones we thought to check", but
    // every numeric lexeme in the entire captured body.
    const lexemes = detailText.match(/(?<=[:,[])\s*-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?=[,}\]])/g) ?? [];
    expect(lexemes.length).toBeGreaterThan(100);

    const seen: string[] = [];
    collect(parseJson(detailText), seen);
    expect(seen.length).toBe(lexemes.length);
    expect(seen).toEqual(lexemes.map((l) => l.trim()));
  });

  it("comparison is exact, not a float comparison in disguise", () => {
    const food = decodeFood(parseJson(detailText));
    const medium = food.servings[0]?.metric_amount;
    if (medium === undefined || medium === null) throw new Error("no metric_amount");

    // Equal as values, not identical as lexemes. Both facts are available.
    expect(medium.equals(new Decimal("138"))).toBe(true);
    expect(medium.identical(new Decimal("138"))).toBe(false);

    // A difference binary64 cannot see at all.
    const a = new Decimal("0.1");
    const b = new Decimal("0.10000000000000001");
    expect(a.toNumber()).toBe(b.toNumber()); // doubles say they are the same
    expect(a.equals(b)).toBe(false); // the values are not
    expect(a.compare(b)).toBe(-1);
  });

  it("re-serialising a response never produces a quoted numeral (DM-N1)", () => {
    // The defect TrackCore exists to fix is `"calories": "72"`. A customer who
    // reads a food and writes it to their own cache or their own API must not
    // reintroduce it through the SDK's types.
    const food = decodeFood(parseJson(detailText));
    const reserialised = JSON.stringify(food);
    expect(reserialised).not.toMatch(/"value":"/);
    expect(reserialised).toContain('"value":72');

    if (Decimal.isExactlyReSerialisable()) {
      // Node 21.3+ / current browsers: JSON.rawJSON, so the round trip is exact.
      expect(reserialised).toContain('"metric_amount":138.000');
    } else {
      // Older runtimes: still a bare number, scale flattened. Documented.
      expect(reserialised).toContain('"metric_amount":138');
    }
  });

  it("both parser paths agree, so the Node 18 fallback is not a second behaviour", () => {
    const viaDefault = JSON.stringify(normalise(parseJson(detailText)));
    const viaPortable = JSON.stringify(normalise(parseStrict(detailText)));
    expect(viaDefault).toBe(viaPortable);
  });

  it("DM-N2: an absent nutrient is null, never zero", () => {
    const food = decodeFood(parseJson(detailText));
    const first = food.servings[0];
    if (first === undefined) throw new Error("no servings");
    // vitamin_d is "" upstream, which coerce turns into absence, not a zero.
    expect(first.nutrition["vitamin_d"]).toBeNull();
    // cholesterol is an affirmative zero from the provider. Different fact.
    expect(first.nutrition["cholesterol"]?.value.isZero()).toBe(true);
    expect(detailText).toContain('"cholesterol":{"value":0,"unit":"mg"}');
  });

  it("the energy reconciliation figures are exact too", () => {
    const food = decodeFood(parseJson(detailText));
    const reconciliation = food.energy_reconciliation;
    if (reconciliation === null) throw new Error("no reconciliation");
    // Food 35718 is ~11% out on every serving; the figure is the provider's own
    // rounding and must not be smoothed by a float.
    expect(reconciliation.provider_value?.toString()).toBe("52");
    expect(reconciliation.computed_value?.toString()).toBe("57.81");
    expect(reconciliation.variance_pct?.toString()).toBe("11.17");
    expect(reconciliation.flagged).toBe(false);
    expect(reconciliation.basis).toBe("per_100g");
  });
});

describe("counters stay plain numbers", () => {
  it("serving_id_version is a number, not a Decimal", () => {
    const food = decodeFood(parseJson(detailText));
    const first = food.servings[0];
    if (first === undefined) throw new Error("no servings");
    expect(first.serving_id_version).toBe(1);
    expect(typeof first.serving_id_version).toBe("number");
  });

  it("no nutritional field is ever converted to a number", () => {
    // The guard on INTEGER_FIELDS: if a future edit adds a nutrient-bearing key
    // to that list, this fails.
    const food = decodeFood(parseJson(detailText));
    for (const serving of food.servings) {
      for (const [code, value] of Object.entries(serving.nutrition)) {
        if (value === null) continue;
        expect(value.value, `${code} must stay a Decimal`).toBeInstanceOf(Decimal);
      }
      for (const key of ["base_quantity", "metric_amount", "gram_weight_per_household_unit"] as const) {
        const field = serving[key];
        if (field !== null) expect(field, `${key} must stay a Decimal`).toBeInstanceOf(Decimal);
      }
    }
  });
});

/** Depth-first walk collecting every Decimal's source, in document order. */
function collect(value: unknown, into: string[]): void {
  if (value instanceof Decimal) {
    into.push(value.source);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) collect(child, into);
  }
}

/** Plain-object copy with Decimals reduced to their source, for comparing trees. */
function normalise(value: unknown): unknown {
  if (value instanceof Decimal) return { __dec: value.source };
  if (Array.isArray(value)) return value.map(normalise);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}
