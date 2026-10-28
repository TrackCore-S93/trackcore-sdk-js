/**
 * The parser. Both paths — the ES2025 native one and the portable one that
 * Node 18 falls back to — are exercised against the same table, because a
 * fallback that behaves differently from the fast path is worse than no
 * fallback at all.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { Decimal } from "../src/decimal.js";
import { JsonParseError, hasNativeSourceAccess, parseJson, parseStrict } from "../src/json.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

const parsers: [string, (text: string) => unknown][] = [
  ["portable", parseStrict],
  ["default", parseJson],
];

describe.each(parsers)("%s parser", (_name, parse) => {
  it("reads the primitives", () => {
    expect(parse("null")).toBeNull();
    expect(parse("true")).toBe(true);
    expect(parse("false")).toBe(false);
    expect(parse('"hello"')).toBe("hello");
    expect(parse("  \n\t 42 ")).toBeInstanceOf(Decimal);
  });

  it("reads nested structures", () => {
    const value = parse('{"a":[1,{"b":null}],"c":{}}') as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(["a", "c"]);
    const a = value["a"] as unknown[];
    expect(a).toHaveLength(2);
    expect((a[1] as Record<string, unknown>)["b"]).toBeNull();
  });

  it("hands every number back as a Decimal carrying its lexeme", () => {
    const value = parse('[0,-0,1e3,-2.5E-3,138.000,0.0300]') as Decimal[];
    expect(value.map((d) => d.source)).toEqual(["0", "-0", "1e3", "-2.5E-3", "138.000", "0.0300"]);
  });

  it("handles string escapes", () => {
    expect(parse('"a\\"b"')).toBe('a"b');
    expect(parse('"\\\\"')).toBe("\\");
    expect(parse('"\\n\\t\\r\\b\\f\\/"')).toBe("\n\t\r\b\f/");
    expect(parse('"\\u00e9"')).toBe("é");
    expect(parse('"\\ud83c\\udf4e"')).toBe("🍎");
    // The real fixture has one: `medium (2-3/4\" dia)`.
    expect(parse('"2-3/4\\" dia"')).toBe('2-3/4" dia');
  });

  it("rejects what is not JSON", () => {
    for (const bad of [
      "",
      "{",
      "[1,]",
      "{'a':1}",
      "{a:1}",
      "NaN",
      "Infinity",
      "01",
      "1.",
      ".1",
      "+1",
      '"unterminated',
      "{} {}",
      "undefined",
    ]) {
      expect(() => parse(bad), bad).toThrow();
    }
  });
});

describe("the portable parser specifically", () => {
  it("keeps __proto__ off the prototype chain", () => {
    const value = parseStrict('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("refuses a document nested beyond the depth limit", () => {
    const deep = "[".repeat(300) + "]".repeat(300);
    expect(() => parseStrict(deep)).toThrow(JsonParseError);
  });

  it("refuses a raw control character inside a string", () => {
    expect(() => parseStrict('"a\nb"')).toThrow(JsonParseError);
  });

  it("reports a position", () => {
    try {
      parseStrict('{"a":}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(JsonParseError);
      expect((error as JsonParseError).position).toBeGreaterThan(0);
    }
  });
});

describe("agreement with the native parser", () => {
  it("accepts and rejects exactly what JSON.parse does", () => {
    const samples = [
      "null",
      "[]",
      "{}",
      '{"a":1}',
      "[1,2,3]",
      '"\\u0041"',
      "1e400", // valid JSON; becomes Infinity as a double, stays exact here
      "{",
      "[1,]",
      "01",
      "'a'",
      "{a:1}",
    ];
    for (const sample of samples) {
      let nativeOk = true;
      try {
        JSON.parse(sample);
      } catch {
        nativeOk = false;
      }
      let ourOk = true;
      try {
        parseStrict(sample);
      } catch {
        ourOk = false;
      }
      expect(ourOk, `disagreement on ${sample}`).toBe(nativeOk);
    }
  });

  it("produces the same tree as JSON.parse for every captured fixture", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(join(FIXTURES, file), "utf8");
      const ours = toPlain(parseStrict(text));
      expect(ours, file).toEqual(JSON.parse(text));
    }
  });

  it("the default parser matches the portable one on every fixture", () => {
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".json"))) {
      const text = readFileSync(join(FIXTURES, file), "utf8");
      expect(sources(parseJson(text)), file).toEqual(sources(parseStrict(text)));
    }
  });
});

describe("runtime capability probe", () => {
  it("reports whether the native source-text path is in use", () => {
    expect(typeof hasNativeSourceAccess).toBe("boolean");
  });
});

/** Decimal -> number, so a tree can be compared against JSON.parse's output. */
function toPlain(value: unknown): unknown {
  if (value instanceof Decimal) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  }
  return value;
}

/** Every Decimal source in document order. */
function sources(value: unknown, into: string[] = []): string[] {
  if (value instanceof Decimal) into.push(value.source);
  else if (Array.isArray(value)) for (const item of value) sources(item, into);
  else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) sources(child, into);
  }
  return into;
}
