/**
 * `Decimal` — an exact decimal value carrier.
 *
 * # Why this type exists at all
 *
 * The backend went to considerable trouble to stop being wrong about numbers.
 * `food-api` sends `"calories": "72"` — a quoted numeral — and three client
 * codebases in the estate carry defensive parsing because of it. TrackCore's
 * DM-N1 says every nutrient value is a JSON **number**, and the nutrition
 * service's `internal/dec` package exists so that `"138.000"` reaches the wire
 * as `138.000`, exactly, with its scale intact.
 *
 * `JSON.parse` would undo all of that in one line. It has exactly one numeric
 * type, IEEE-754 binary64, so:
 *
 * ```
 *   wire                          JSON.parse                 lost
 *   138.000                       138                        scale
 *   0.030                         0.03                       scale
 *   28.350                        28.35                      scale
 *   138.0000000000000000          138                        sixteen digits
 *   19.06                         19.059999999999998721…     exactness
 *   0.039                         0.039000000000000000222…   exactness
 * ```
 *
 * The scale losses are information losses: the provider reported a figure to a
 * stated precision and that precision is part of the datum. The exactness
 * losses are worse, because they compound. A day of logging is a few dozen
 * additions, and binary64 addition is not associative; two clients that sum the
 * same entries in different orders can disagree about a calorie total. That is
 * precisely the drift the backend just removed, reintroduced on the customer's
 * side where nobody is looking for it.
 *
 * # What this type does and does not do
 *
 * It carries **the exact lexeme the server sent** and nothing else. `source` is
 * the substring of the response body, byte for byte.
 *
 * It deliberately offers **no arithmetic**. SDK-C2 is explicit: "No SDK
 * contains numeric string-parsing, serving normalisation, nutrition summation
 * or portion scaling." Shipping `add()` here would be an invitation to do the
 * one thing the product forbids, and it would mean shipping a bignum
 * implementation, which SDK-W4 ("zero runtime dependencies") rules out anyway.
 *
 * What it does offer is everything you need *without* arithmetic: the exact
 * string, an explicit conversion to `number`, exact comparison, and a JSON
 * round-trip that never re-quotes a numeral. If you genuinely need to compute
 * on these values outside what the API offers, hand `.toString()` to
 * `decimal.js` or `big.js` — a lossless lexeme is exactly what those libraries
 * want as input, and that handover is the whole point of keeping it.
 */

/** The two parts a decimal lexeme is normalised into for exact comparison. */
interface Normalised {
  /** `-1`, `0` or `1`. Zero is always sign `0`, so `-0.0` equals `0`. */
  sign: -1 | 0 | 1;
  /** Significant digits, no leading or trailing zeros. `""` when the value is zero. */
  digits: string;
  /** Value is `sign * 0.{digits} * 10 ** exponent`. */
  exponent: number;
}

/**
 * A JSON number as the grammar defines it (RFC 8259 §6). Deliberately stricter
 * than `Number()`: no leading `+`, no leading zeros, no `Infinity`, no `NaN`,
 * no hex. A lexeme that does not match this never came out of a conforming JSON
 * encoder, so it is a parse error rather than something to coerce.
 */
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

/** `JSON.rawJSON` is ES2025; it exists in Node 21.3+ and recent browsers. */
const rawJSON: ((text: string) => unknown) | undefined =
  typeof (JSON as { rawJSON?: unknown }).rawJSON === "function"
    ? ((JSON as unknown as { rawJSON: (text: string) => unknown }).rawJSON)
    : undefined;

export class Decimal {
  /**
   * The lexeme exactly as it arrived on the wire. `"138.000"` stays
   * `"138.000"`; nothing is trimmed, padded or re-rendered.
   */
  readonly source: string;

  /** Lazily computed, so the double is never produced unless somebody asks. */
  #number: number | undefined;
  #normalised: Normalised | undefined;

  constructor(source: string) {
    if (!JSON_NUMBER.test(source)) {
      throw new TypeError(`Decimal: ${JSON.stringify(source)} is not a JSON number literal`);
    }
    this.source = source;
    Object.freeze(this);
  }

  /** Build from a `number`. Lossy at the call site, by construction and on purpose. */
  static fromNumber(value: number): Decimal {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Decimal: ${String(value)} has no JSON representation`);
    }
    return new Decimal(String(value));
  }

  static readonly ZERO: Decimal = new Decimal("0");

  /** Returns the exact lexeme. `${decimal}` and `String(decimal)` are exact. */
  toString(): string {
    return this.source;
  }

  /**
   * The IEEE-754 double. **This is the lossy conversion** — it is a named
   * method rather than the default representation so that losing precision is
   * something the calling code says out loud.
   */
  toNumber(): number {
    this.#number ??= Number(this.source);
    return this.#number;
  }

  /**
   * Coercion in a numeric context: `+d`, `d < 5`, `Math.max(a, b)`.
   *
   * The same lossy double as {@link toNumber}, and it exists for
   * plain-JavaScript callers only. **TypeScript refuses every one of those
   * expressions**, because relational and arithmetic operators are not allowed
   * on an object type whatever its `valueOf` — so a TypeScript caller is pushed
   * toward {@link toNumber} and {@link compare}, which is where they should be.
   *
   * A JavaScript caller gets no such nudge, and for them this method is what
   * stands between the type and a silent *lexicographic* comparison, where
   * `"9" > "10"`. A documented lossy number beats a silent sorting bug.
   */
  valueOf(): number {
    return this.toNumber();
  }

  /**
   * `JSON.stringify` of a Decimal is a bare JSON **number**, never a quoted
   * string — re-serialising a TrackCore response must not reintroduce the very
   * defect (DM-N1) the API exists to fix.
   *
   * Where `JSON.rawJSON` exists (Node 21.3+, current browsers) the original
   * lexeme is emitted verbatim and the round-trip is byte-exact. Where it does
   * not, the value degrades to a bare double — still unquoted, so still
   * DM-N1-clean, but with the scale flattened. {@link isExactlyReSerialisable}
   * reports which of the two you are getting.
   */
  toJSON(): unknown {
    return rawJSON ? rawJSON(this.source) : this.toNumber();
  }

  /** Whether `JSON.stringify` on this runtime will reproduce `source` exactly. */
  static isExactlyReSerialisable(): boolean {
    return rawJSON !== undefined;
  }

  /** Number of digits after the decimal point, as written. `138.000` → 3. */
  get scale(): number {
    const point = this.source.indexOf(".");
    if (point < 0) return 0;
    const exponent = this.source.search(/[eE]/);
    const end = exponent < 0 ? this.source.length : exponent;
    return end - point - 1;
  }

  /** Whether the value is an integer *as a value*. `138.000` is an integer. */
  isInteger(): boolean {
    const { digits, exponent } = this.#norm();
    return digits === "" || exponent >= digits.length;
  }

  /** Whether the value is exactly zero. `0`, `0.000` and `-0.0` all qualify. */
  isZero(): boolean {
    return this.#norm().sign === 0;
  }

  /**
   * The value as a safe JavaScript integer.
   *
   * For the handful of genuinely integral fields in the API — `page`,
   * `page_size`, `total_results`, `serving_id_version`, `retry_after_seconds`,
   * `limit` — where a `Decimal` would be noise. Throws rather than rounding:
   * a non-integer here means the response was not the shape we think it is.
   */
  toInt(): number {
    if (!this.isInteger()) {
      throw new TypeError(`Decimal: ${this.source} is not an integer`);
    }
    const value = this.toNumber();
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`Decimal: ${this.source} is outside the safe integer range`);
    }
    return value;
  }

  /**
   * Exact numeric comparison: `-1`, `0` or `1`.
   *
   * Compares the decimal values, not the lexemes, and never goes near a double.
   * `138.000` equals `138`; `0.1` is less than `0.10000000000000001`, which
   * `toNumber()` would tell you are the same number.
   */
  compare(other: Decimal): -1 | 0 | 1 {
    const a = this.#norm();
    const b = other.#norm();
    if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
    if (a.sign === 0) return 0;
    const magnitude = compareMagnitude(a, b);
    return a.sign === 1 ? magnitude : (-magnitude as -1 | 0 | 1);
  }

  /** Exact equality. `new Decimal("138.000").equals(new Decimal("138"))` is true. */
  equals(other: Decimal): boolean {
    return this.compare(other) === 0;
  }

  /** Lexeme identity: `138.000` and `138` are *not* identical, only equal. */
  identical(other: Decimal): boolean {
    return this.source === other.source;
  }

  /** `util.inspect` / console output shows the exact value, not the double. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Decimal(${this.source})`;
  }

  #norm(): Normalised {
    this.#normalised ??= normalise(this.source);
    return this.#normalised;
  }
}

/**
 * Splits a lexeme into `sign * 0.{digits} * 10 ** exponent` with no leading or
 * trailing zeros, which makes two normalised forms comparable digit by digit.
 */
function normalise(source: string): Normalised {
  const negative = source.charCodeAt(0) === 0x2d; // '-'
  let rest = negative ? source.slice(1) : source;

  let exponent = 0;
  const e = rest.search(/[eE]/);
  if (e >= 0) {
    exponent = Number(rest.slice(e + 1));
    rest = rest.slice(0, e);
  }

  const point = rest.indexOf(".");
  let digits: string;
  if (point < 0) {
    digits = rest;
  } else {
    digits = rest.slice(0, point) + rest.slice(point + 1);
    exponent -= rest.length - point - 1;
  }

  // Strip leading zeros; each one removed does not change the exponent because
  // the exponent is anchored to the end of the digit string.
  let start = 0;
  while (start < digits.length && digits.charCodeAt(start) === 0x30) start++;
  digits = digits.slice(start);

  // Strip trailing zeros; each one removed raises the exponent by one.
  let end = digits.length;
  while (end > 0 && digits.charCodeAt(end - 1) === 0x30) {
    end--;
    exponent++;
  }
  digits = digits.slice(0, end);

  if (digits === "") return { sign: 0, digits: "", exponent: 0 };
  // Re-anchor so the value is 0.{digits} * 10 ** exponent.
  return { sign: negative ? -1 : 1, digits, exponent: exponent + digits.length };
}

/** Compares two non-zero normalised magnitudes. */
function compareMagnitude(a: Normalised, b: Normalised): -1 | 0 | 1 {
  if (a.exponent !== b.exponent) return a.exponent < b.exponent ? -1 : 1;
  const length = Math.max(a.digits.length, b.digits.length);
  for (let i = 0; i < length; i++) {
    // Past the end of a digit string the value is zero, which is why the
    // trailing zeros were stripped: `12` and `120` differ by exponent, not here.
    const left = i < a.digits.length ? a.digits.charCodeAt(i) : 0x30;
    const right = i < b.digits.length ? b.digits.charCodeAt(i) : 0x30;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/** Narrowing helper, so `unknown` from a raw body can be refined safely. */
export function isDecimal(value: unknown): value is Decimal {
  return value instanceof Decimal;
}
