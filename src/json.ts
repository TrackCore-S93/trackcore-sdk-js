/**
 * A JSON parser that hands every number back as a {@link Decimal} carrying the
 * original lexeme.
 *
 * # Why not `JSON.parse` with a reviver
 *
 * A reviver is called with the value *after* it has been parsed. By then the
 * number is already a double and `138.000` is already `138` — the information
 * the reviver would need has been destroyed one step before it runs.
 *
 * ES2025 added `context.source` to the reviver, which does give the raw lexeme,
 * and where it exists this module uses it: it is the native parser, so it is
 * fast, and the lexeme is the same one this parser would produce. But SDK-W2
 * fixes the floor at Node 18, which has no `context.source` — and the thing we
 * are protecting against is a *silent* precision loss, so "fast where
 * available, wrong where not" is not an acceptable shape for this particular
 * function. The hand-written parser below is therefore the baseline and the
 * native path is an optimisation layered on top; {@link parseJson} picks one at
 * load time and both are covered by the same tests.
 *
 * # Scope
 *
 * This is a strict RFC 8259 parser. It accepts what a conforming encoder emits
 * and refuses the rest — no trailing commas, no comments, no `NaN`, no single
 * quotes, no unquoted keys. A TrackCore response that does not parse here is a
 * `ProtocolError`, which is the honest answer; being lenient would mean
 * guessing what a broken middlebox meant.
 *
 * `__proto__` as an object key is stored as an own data property rather than
 * being allowed to reach `Object.prototype`. The native parser does the same,
 * and skipping it here would make this module the weaker of the two.
 */

import { Decimal } from "./decimal.js";

/** The shape this parser produces: JSON, with `Decimal` in every numeric slot. */
export type JsonValue =
  | null
  | boolean
  | string
  | Decimal
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Thrown for a body that is not well-formed JSON. Carries no body content. */
export class JsonParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = "JsonParseError";
    this.position = position;
  }
}

/**
 * Does this runtime support `JSON.parse`'s ES2025 reviver source text? Probed
 * rather than version-sniffed, because a polyfill or a bundler's downlevelling
 * can change the answer on any given runtime.
 */
export const hasNativeSourceAccess: boolean = (() => {
  try {
    let seen: unknown;
    JSON.parse("1.50", function (_key, _value, context?: { source?: string }) {
      seen = context?.source;
      return _value as unknown;
    } as (this: unknown, key: string, value: unknown) => unknown);
    return seen === "1.50";
  } catch {
    return false;
  }
})();

/**
 * Parse a JSON document, preserving every number's exact lexeme.
 *
 * This is the only entry point the transport uses. `JSON.parse` must not appear
 * on a response path anywhere in this SDK; `test/no-naive-parse.test.ts`
 * asserts that, because the failure mode is silent and a single careless line
 * would reintroduce it.
 */
export function parseJson(text: string): JsonValue {
  return hasNativeSourceAccess ? parseNative(text) : parseStrict(text);
}

/** The ES2025 fast path: native parsing, lexeme recovered from the reviver. */
function parseNative(text: string): JsonValue {
  type Reviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;
  const reviver: Reviver = (_key, value, context) => {
    // `context.source` is present only for primitives, and only the numeric
    // ones need rewrapping. `typeof value === "number"` is the discriminator:
    // strings, booleans and null pass straight through.
    if (typeof value === "number" && typeof context?.source === "string") {
      return new Decimal(context.source);
    }
    return value;
  };
  try {
    return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown) as JsonValue;
  } catch (cause) {
    if (cause instanceof JsonParseError) throw cause;
    // Re-raise in this module's own shape, with no fragment of the document in
    // the message: a parse failure often means a proxy injected something, and
    // echoing it would be the leak this SDK is supposed to prevent.
    throw new JsonParseError("the response body is not well-formed JSON", -1);
  }
}

// ---------------------------------------------------------------------------
// The portable parser (Node 18, older browsers)
// ---------------------------------------------------------------------------

const enum Char {
  Tab = 0x09,
  LineFeed = 0x0a,
  CarriageReturn = 0x0d,
  Space = 0x20,
  Quote = 0x22,
  Plus = 0x2b,
  Comma = 0x2c,
  Minus = 0x2d,
  Dot = 0x2e,
  Zero = 0x30,
  Nine = 0x39,
  Colon = 0x3a,
  UpperE = 0x45,
  OpenBracket = 0x5b,
  Backslash = 0x5c,
  CloseBracket = 0x5d,
  LowerE = 0x65,
  OpenBrace = 0x7b,
  CloseBrace = 0x7d,
}

class Reader {
  readonly text: string;
  index = 0;
  /** Guards against a hostile body nesting arrays a million deep. */
  depth = 0;

  constructor(text: string) {
    this.text = text;
  }

  fail(message: string): never {
    throw new JsonParseError(message, this.index);
  }
}

const MAX_DEPTH = 256;

export function parseStrict(text: string): JsonValue {
  if (typeof text !== "string") {
    throw new JsonParseError("expected a string to parse", 0);
  }
  const reader = new Reader(text);
  skipWhitespace(reader);
  const value = readValue(reader);
  skipWhitespace(reader);
  if (reader.index !== text.length) {
    reader.fail("unexpected trailing content after the JSON document");
  }
  return value;
}

function skipWhitespace(r: Reader): void {
  const { text } = r;
  let i = r.index;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === Char.Space || c === Char.Tab || c === Char.LineFeed || c === Char.CarriageReturn) {
      i++;
    } else {
      break;
    }
  }
  r.index = i;
}

function readValue(r: Reader): JsonValue {
  if (r.index >= r.text.length) r.fail("unexpected end of input");
  const c = r.text.charCodeAt(r.index);
  switch (c) {
    case Char.OpenBrace:
      return readObject(r);
    case Char.OpenBracket:
      return readArray(r);
    case Char.Quote:
      return readString(r);
    default:
      break;
  }
  if (c === Char.Minus || (c >= Char.Zero && c <= Char.Nine)) return readNumber(r);
  if (r.text.startsWith("true", r.index)) {
    r.index += 4;
    return true;
  }
  if (r.text.startsWith("false", r.index)) {
    r.index += 5;
    return false;
  }
  if (r.text.startsWith("null", r.index)) {
    r.index += 4;
    return null;
  }
  return r.fail("unexpected token");
}

function readObject(r: Reader): JsonObject {
  if (++r.depth > MAX_DEPTH) r.fail("the document nests too deeply");
  r.index++; // '{'
  // A null-prototype object, then handed back as a plain record. `__proto__`
  // from the wire therefore lands as an own key and cannot reach the prototype
  // chain, which is the same guarantee JSON.parse gives.
  const out = Object.create(null) as JsonObject;
  skipWhitespace(r);
  if (r.text.charCodeAt(r.index) === Char.CloseBrace) {
    r.index++;
    r.depth--;
    return out;
  }
  for (;;) {
    skipWhitespace(r);
    if (r.text.charCodeAt(r.index) !== Char.Quote) r.fail("expected a quoted object key");
    const key = readString(r);
    skipWhitespace(r);
    if (r.text.charCodeAt(r.index) !== Char.Colon) r.fail("expected ':' after an object key");
    r.index++;
    skipWhitespace(r);
    out[key] = readValue(r);
    skipWhitespace(r);
    const c = r.text.charCodeAt(r.index);
    if (c === Char.Comma) {
      r.index++;
      continue;
    }
    if (c === Char.CloseBrace) {
      r.index++;
      r.depth--;
      return out;
    }
    r.fail("expected ',' or '}' in an object");
  }
}

function readArray(r: Reader): JsonValue[] {
  if (++r.depth > MAX_DEPTH) r.fail("the document nests too deeply");
  r.index++; // '['
  const out: JsonValue[] = [];
  skipWhitespace(r);
  if (r.text.charCodeAt(r.index) === Char.CloseBracket) {
    r.index++;
    r.depth--;
    return out;
  }
  for (;;) {
    skipWhitespace(r);
    out.push(readValue(r));
    skipWhitespace(r);
    const c = r.text.charCodeAt(r.index);
    if (c === Char.Comma) {
      r.index++;
      continue;
    }
    if (c === Char.CloseBracket) {
      r.index++;
      r.depth--;
      return out;
    }
    r.fail("expected ',' or ']' in an array");
  }
}

function readString(r: Reader): string {
  const { text } = r;
  let i = r.index + 1; // past the opening quote
  const start = i;

  // Fast path: scan for the closing quote. If nothing had to be unescaped the
  // whole string is one slice, which is most keys and most values.
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === Char.Quote) {
      r.index = i + 1;
      return text.slice(start, i);
    }
    if (c === Char.Backslash) break;
    if (c < Char.Space) r.fail("a raw control character is not valid inside a JSON string");
    i++;
  }
  if (i >= text.length) r.fail("unterminated string");

  // Slow path: at least one escape.
  let out = text.slice(start, i);
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === Char.Quote) {
      r.index = i + 1;
      return out;
    }
    if (c < Char.Space) r.fail("a raw control character is not valid inside a JSON string");
    if (c !== Char.Backslash) {
      const chunk = i;
      while (i < text.length) {
        const n = text.charCodeAt(i);
        if (n === Char.Quote || n === Char.Backslash || n < Char.Space) break;
        i++;
      }
      out += text.slice(chunk, i);
      continue;
    }
    i++;
    const escape = text[i];
    if (escape === undefined) r.fail("unterminated escape sequence");
    switch (escape) {
      case '"':
        out += '"';
        i++;
        break;
      case "\\":
        out += "\\";
        i++;
        break;
      case "/":
        out += "/";
        i++;
        break;
      case "b":
        out += "\b";
        i++;
        break;
      case "f":
        out += "\f";
        i++;
        break;
      case "n":
        out += "\n";
        i++;
        break;
      case "r":
        out += "\r";
        i++;
        break;
      case "t":
        out += "\t";
        i++;
        break;
      case "u": {
        const hex = text.slice(i + 1, i + 5);
        if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
          r.index = i;
          r.fail("malformed \\u escape");
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 5;
        break;
      }
      default:
        r.index = i;
        r.fail("unknown escape sequence");
    }
  }
  return r.fail("unterminated string");
}

function readNumber(r: Reader): Decimal {
  const { text } = r;
  const start = r.index;
  let i = r.index;

  if (text.charCodeAt(i) === Char.Minus) i++;

  // int: `0` alone, or a non-zero digit followed by digits. `01` is invalid
  // JSON, and accepting it would mean this parser disagrees with JSON.parse
  // about whether a body is well-formed.
  if (text.charCodeAt(i) === Char.Zero) {
    i++;
  } else {
    const from = i;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c < Char.Zero || c > Char.Nine) break;
      i++;
    }
    if (i === from) r.fail("expected a digit");
  }

  if (text.charCodeAt(i) === Char.Dot) {
    i++;
    const from = i;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c < Char.Zero || c > Char.Nine) break;
      i++;
    }
    if (i === from) r.fail("expected a digit after the decimal point");
  }

  const exponentMarker = text.charCodeAt(i);
  if (exponentMarker === Char.LowerE || exponentMarker === Char.UpperE) {
    i++;
    const sign = text.charCodeAt(i);
    if (sign === Char.Plus || sign === Char.Minus) i++;
    const from = i;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c < Char.Zero || c > Char.Nine) break;
      i++;
    }
    if (i === from) r.fail("expected a digit in the exponent");
  }

  r.index = i;
  // The lexeme crosses into Decimal untouched. This slice is the whole point of
  // the module.
  return new Decimal(text.slice(start, i));
}
