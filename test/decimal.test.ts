import { describe, expect, it } from "vitest";
import { Decimal, isDecimal } from "../src/decimal.js";

describe("Decimal construction", () => {
  it("accepts the JSON number grammar and nothing else", () => {
    for (const good of ["0", "-0", "138.000", "0.039", "1e10", "-2.5E-3", "28.350", "9007199254740993"]) {
      expect(() => new Decimal(good)).not.toThrow();
    }
    // `Number()` would happily take every one of these. JSON does not, and a
    // lexeme that is not JSON did not come from a conforming encoder.
    for (const bad of ["", " 1", "+1", "01", ".5", "5.", "0x10", "Infinity", "NaN", "1_000"]) {
      expect(() => new Decimal(bad), bad).toThrow(TypeError);
    }
  });

  it("is frozen, so a value cannot be mutated after it is handed over", () => {
    const value = new Decimal("1.50");
    expect(Object.isFrozen(value)).toBe(true);
  });
});

describe("Decimal representation", () => {
  it("toString and template interpolation are exact", () => {
    const value = new Decimal("138.000");
    expect(value.toString()).toBe("138.000");
    expect(`${value}`).toBe("138.000");
    expect(String(value)).toBe("138.000");
    expect(value.source).toBe("138.000");
  });

  it("toNumber is the explicit lossy conversion", () => {
    const value = new Decimal("138.000");
    expect(value.toNumber()).toBe(138);
  });

  it("valueOf makes numeric coercion sane for plain-JavaScript callers", () => {
    // TypeScript refuses `d < 200` and `+d` outright — relational and unary
    // operators are not allowed on an object type, whatever its `valueOf`. So
    // in TypeScript these casts are the only way to even write the test, and a
    // TypeScript caller is pushed toward `.toNumber()` and `.compare()`, which
    // is the right place to end up.
    //
    // A plain-JavaScript caller gets no such nudge, and for them `valueOf` is
    // what stands between this type and a silent lexicographic comparison,
    // where "9" > "10" and nothing warns you.
    const value = new Decimal("138.000") as unknown as number;
    expect(+value).toBe(138);
    expect(value < 200).toBe(true);
    expect((new Decimal("9") as unknown as number) > (new Decimal("10") as unknown as number)).toBe(false);
    expect(Math.max(value, 10)).toBe(138);
  });

  it("scale reports the digits as written", () => {
    expect(new Decimal("138.000").scale).toBe(3);
    expect(new Decimal("138").scale).toBe(0);
    expect(new Decimal("0.039").scale).toBe(3);
    expect(new Decimal("1.5e3").scale).toBe(1);
  });
});

describe("Decimal comparison is exact", () => {
  const cases: [string, string, -1 | 0 | 1][] = [
    ["138.000", "138", 0],
    ["0", "-0", 0],
    ["0.000", "0", 0],
    ["1.0", "1.00", 0],
    ["0.1", "0.10000000000000001", -1],
    ["9", "10", -1],
    ["-5", "-4", -1],
    ["-5", "5", -1],
    ["1e3", "1000", 0],
    ["1e3", "1000.0001", -1],
    ["28.350", "28.35", 0],
    ["19.06", "19.060000000000000001", -1],
  ];

  for (const [left, right, expected] of cases) {
    it(`${left} vs ${right} is ${expected}`, () => {
      expect(new Decimal(left).compare(new Decimal(right))).toBe(expected);
      expect(new Decimal(right).compare(new Decimal(left))).toBe(-expected === 0 ? 0 : -expected);
      expect(new Decimal(left).equals(new Decimal(right))).toBe(expected === 0);
    });
  }

  it("distinguishes equal from identical", () => {
    expect(new Decimal("1.50").equals(new Decimal("1.5"))).toBe(true);
    expect(new Decimal("1.50").identical(new Decimal("1.5"))).toBe(false);
    expect(new Decimal("1.50").identical(new Decimal("1.50"))).toBe(true);
  });
});

describe("Decimal predicates", () => {
  it("isZero distinguishes an affirmative zero from a value near it", () => {
    expect(new Decimal("0").isZero()).toBe(true);
    expect(new Decimal("0.000").isZero()).toBe(true);
    expect(new Decimal("-0").isZero()).toBe(true);
    expect(new Decimal("0.0001").isZero()).toBe(false);
  });

  it("isInteger asks about the value, not the spelling", () => {
    expect(new Decimal("138.000").isInteger()).toBe(true);
    expect(new Decimal("138").isInteger()).toBe(true);
    expect(new Decimal("1e3").isInteger()).toBe(true);
    expect(new Decimal("0").isInteger()).toBe(true);
    expect(new Decimal("138.001").isInteger()).toBe(false);
    expect(new Decimal("0.039").isInteger()).toBe(false);
  });

  it("toInt refuses rather than rounding", () => {
    expect(new Decimal("20").toInt()).toBe(20);
    expect(new Decimal("20.000").toInt()).toBe(20);
    expect(() => new Decimal("20.5").toInt()).toThrow(TypeError);
    expect(() => new Decimal("1e40").toInt()).toThrow(/safe integer/);
  });
});

describe("Decimal JSON", () => {
  it("never stringifies as a quoted numeral", () => {
    const value = new Decimal("138.000");
    expect(JSON.stringify({ v: value })).not.toContain('"138');
    expect(JSON.stringify({ v: value })).toMatch(/^\{"v":138(\.000)?\}$/);
  });

  it("round-trips exactly where JSON.rawJSON exists", () => {
    const value = new Decimal("0.0300");
    const text = JSON.stringify(value);
    if (Decimal.isExactlyReSerialisable()) {
      expect(text).toBe("0.0300");
    } else {
      expect(text).toBe("0.03");
    }
  });
});

describe("Decimal helpers", () => {
  it("fromNumber is the lossy direction, named as such", () => {
    expect(Decimal.fromNumber(138).toString()).toBe("138");
    expect(() => Decimal.fromNumber(Number.NaN)).toThrow(TypeError);
    expect(() => Decimal.fromNumber(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("isDecimal narrows", () => {
    expect(isDecimal(new Decimal("1"))).toBe(true);
    expect(isDecimal(1)).toBe(false);
    expect(isDecimal("1")).toBe(false);
    expect(isDecimal(null)).toBe(false);
  });
});
