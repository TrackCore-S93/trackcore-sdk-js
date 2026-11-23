/**
 * Logging from `Food.measurements`.
 *
 * A measurement is one unit an end user picked (a gram, a slice, a cup). The
 * diary still takes a serving and a quantity, so one number has to be worked
 * out: how much of the measurement's serving the typed amount is. That is
 * `amount × consumed_quantity_per_unit`, to the four decimals the diary
 * stores.
 *
 * It is done here in exact decimal arithmetic. In floating point 0.07 × 100
 * is 7.000000000000001, and a quantity with fifteen decimals is refused by
 * the API. A `BigInt` holds the digits; no `number` touches the value.
 *
 * This is a quantity, not a nutrient. The rule in `resources/foods.ts` stands:
 * no nutrient is multiplied on the client (SDK-C2, DM-N10). What the entry is
 * worth is still worked out by the server, from the quantity this returns.
 */

import { Decimal } from "./decimal.js";
import type { Measurement } from "./models.js";

/** The scale of the diary's `consumed_quantity`. */
const QUANTITY_PLACES = 4;

const NUMBER = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

interface Scaled {
  /** Every digit, with the point removed. */
  readonly digits: bigint;
  /** How many of those digits sit after the point. */
  readonly scale: number;
}

function scaled(text: string, what: string): Scaled {
  const match = NUMBER.exec(text.trim());
  if (match === null) {
    throw new RangeError(`${what} must be a positive number, got ${JSON.stringify(text)}`);
  }
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const exponent = match[3] === undefined ? 0 : Number(match[3]);
  let digits = BigInt(whole + fraction);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits *= BigInt(10) ** BigInt(-scale);
    scale = 0;
  }
  return { digits, scale };
}

/**
 * The `consumedQuantity` that logs `amount` of a measurement.
 *
 * ```ts
 * const grams = food.measurements.find((m) => m.label === "g")!;
 * await client.diary.log({
 *   foodId: food.food_id,
 *   selectedServingId: grams.serving_id,
 *   consumedQuantity: consumedQuantityFor(grams, 150),
 *   timezone,
 * });
 * ```
 *
 * `amount` is what the end user typed in the measurement's own unit: 150 for
 * 150 g, 2 for two slices. A string is read as written, so `"0.1"` is exactly
 * a tenth.
 *
 * The result is a {@link Decimal}, because that is what goes on the wire as a
 * bare JSON number. The API refuses a quantity sent as a string.
 *
 * @throws RangeError when the amount is not a positive number, or is so small
 * that it rounds to nothing at four decimals.
 */
export function consumedQuantityFor(
  measurement: Pick<Measurement, "consumed_quantity_per_unit">,
  amount: number | string | Decimal,
): Decimal {
  if (typeof amount === "number" && !Number.isFinite(amount)) {
    throw new RangeError(`amount must be a positive number, got ${String(amount)}`);
  }
  const typed = scaled(amount instanceof Decimal ? amount.source : String(amount), "amount");
  const factor = scaled(measurement.consumed_quantity_per_unit.source, "consumed_quantity_per_unit");

  let digits = typed.digits * factor.digits;
  let scale = typed.scale + factor.scale;
  if (scale > QUANTITY_PLACES) {
    // Half away from zero, which for a positive number is half up.
    const divisor = BigInt(10) ** BigInt(scale - QUANTITY_PLACES);
    const remainder = digits % divisor;
    digits = digits / divisor + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0));
    scale = QUANTITY_PLACES;
  }
  if (digits <= BigInt(0)) {
    throw new RangeError(
      `amount ${JSON.stringify(String(amount instanceof Decimal ? amount.source : amount))} is too small to log: it is less than 0.0001 of the serving`,
    );
  }

  const text = digits.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, text.length - scale);
  const fraction = text.slice(text.length - scale).replace(/0+$/, "");
  return new Decimal(fraction === "" ? whole : `${whole}.${fraction}`);
}
