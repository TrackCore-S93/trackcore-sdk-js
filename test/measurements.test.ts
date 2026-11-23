/**
 * `Food.measurements`, and the one number an app has to work out to log from
 * it.
 */

import { describe, expect, it } from "vitest";
import { consumedQuantityFor, Decimal, parseJson, type Food, type Measurement } from "../src/index.js";

const per = (factor: string) => ({ consumed_quantity_per_unit: new Decimal(factor) });

describe("consumedQuantityFor", () => {
  it("is the amount itself on a measurement counted in its own unit", () => {
    expect(consumedQuantityFor(per("1"), 150).toString()).toBe("150");
    expect(consumedQuantityFor(per("1"), "2.5").toString()).toBe("2.5");
    expect(consumedQuantityFor(per("1"), new Decimal("0.5")).toString()).toBe("0.5");
  });

  it("scales where the serving counts in something else", () => {
    // A `100 g` serving with base_quantity 1: a gram is a hundredth of it.
    expect(consumedQuantityFor(per("0.01"), 150).toString()).toBe("1.5");
    // An `8 fl oz` bottle: one fluid ounce is an eighth of it.
    expect(consumedQuantityFor(per("0.125"), 12).toString()).toBe("1.5");
    // Ounces, logged against the gram serving.
    expect(consumedQuantityFor(per("28.3495"), 3).toString()).toBe("85.0485");
  });

  it("is exact where floating point is not", () => {
    // 0.07 * 100 is 7.000000000000001 as a double.
    expect(consumedQuantityFor(per("100"), 0.07).toString()).toBe("7");
    expect(consumedQuantityFor(per("0.1"), "0.3").toString()).toBe("0.03");
  });

  it("rounds to the four decimals the diary stores, half up", () => {
    // A bowl of 300 g, logged by the gram: 0.00333333 a gram.
    expect(consumedQuantityFor(per("0.00333333"), 300).toString()).toBe("1");
    expect(consumedQuantityFor(per("0.00333333"), 150).toString()).toBe("0.5");
    expect(consumedQuantityFor(per("0.283495"), 1).toString()).toBe("0.2835");
    expect(consumedQuantityFor(per("1"), "1.00005").toString()).toBe("1.0001");
    expect(consumedQuantityFor(per("1"), "1.00004").toString()).toBe("1");
  });

  it("reads a number written with an exponent", () => {
    expect(consumedQuantityFor(per("1e-2"), 250).toString()).toBe("2.5");
    expect(consumedQuantityFor(per("1"), 1e3).toString()).toBe("1000");
  });

  it("returns a Decimal, which goes on the wire as a bare number", () => {
    // The API answers 400 body_not_json to a quantity sent as a string.
    const quantity = consumedQuantityFor(per("0.01"), 150);
    expect(quantity).toBeInstanceOf(Decimal);
    expect(JSON.stringify({ consumed_quantity: quantity })).toBe('{"consumed_quantity":1.5}');
  });

  it("refuses an amount the diary would refuse", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "", "abc", "-2", "1,5"]) {
      expect(() => consumedQuantityFor(per("1"), bad), String(bad)).toThrow(RangeError);
    }
    // Less than a ten-thousandth of the serving rounds to nothing.
    expect(() => consumedQuantityFor(per("0.01"), "0.001")).toThrow(/too small/);
  });
});

describe("Food.measurements", () => {
  const body = `{
    "food_id": "01a163d2-b574-7abd-8f84-42fc499ffac3",
    "measurements": [
      {"label":"g","detail":null,"kind":"weight","serving_id":"fs:1:50321",
       "consumed_quantity_per_unit":1,"default_amount":100,"weight_g":1,"volume_ml":null,
       "is_default":true,"nutrition":{"energy":{"value":1.95,"unit":"kcal"}}},
      {"label":"small","detail":"yield after cooking, bone removed","kind":"portion","serving_id":"fs:1:5034",
       "consumed_quantity_per_unit":1,"default_amount":1,"weight_g":168,"volume_ml":null,
       "is_default":false,"nutrition":{"energy":{"value":328,"unit":"kcal"}}}
    ]
  }`;

  it("keeps every number a Decimal, as written", () => {
    const food = parseJson(body) as unknown as Food;
    const [grams, small] = food.measurements as [Measurement, Measurement];
    expect(grams.label).toBe("g");
    expect(grams.consumed_quantity_per_unit).toBeInstanceOf(Decimal);
    expect(grams.nutrition["energy"]?.value.source).toBe("1.95");
    expect(grams.volume_ml).toBeNull();
    expect(small.detail).toBe("yield after cooking, bone removed");
    expect(small.weight_g?.source).toBe("168");
    expect(consumedQuantityFor(grams, 150).toString()).toBe("150");
  });
});
