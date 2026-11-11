import { decodeCalculateResult } from "../decode.js";
import type { HasTransport } from "./foods";
import type { ActivityLevel, CalculateResult, Sex } from "../models";
import { decimalOrNull } from "./profile.js";

/**
 * `POST /v1/nutrition/calculate` — BMR and TDEE.
 *
 * A pure calculation over the numbers sent: Mifflin-St Jeor with both sex
 * constants, times the standard activity multiplier. It names no end user and
 * needs no `setUser`.
 *
 * `energy`, `protein`, `carbohydrate`, `fat` and `estimated_days_to_goal` come
 * back **null** and are named in `undecided_fields`: the daily targets are the
 * customer's own numbers, set with `diary.setGoal`.
 */
export interface CalculateParams {
  readonly age: number;
  readonly heightCm: string | number;
  readonly weightKg: string | number;
  /** Required; the enumeration is closed and nothing is defaulted. */
  readonly sex: Sex;
  readonly activityLevel: ActivityLevel;
  readonly goal?: string | undefined;
  readonly goalWeightKg?: string | number | null | undefined;
  readonly signal?: AbortSignal | undefined;
}

export async function calculateTargets(client: HasTransport, params: CalculateParams): Promise<CalculateResult> {
  const body: Record<string, unknown> = {
    age: params.age,
    height_cm: decimalOrNull(params.heightCm),
    weight_kg: decimalOrNull(params.weightKg),
    sex: params.sex,
    activity_level: params.activityLevel,
  };
  if (params.goal !== undefined) body["goal"] = params.goal;
  if (params.goalWeightKg !== undefined) body["goal_weight_kg"] = decimalOrNull(params.goalWeightKg);
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/nutrition/calculate",
    body,
    signal: params.signal,
  });
  return decodeCalculateResult(response.body);
}
