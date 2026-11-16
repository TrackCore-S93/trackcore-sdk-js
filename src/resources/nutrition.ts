import { decodeCalculateResult, decodeNutritionPlan } from "../decode.js";
import type { HasTransport } from "./foods";
import type { ActivityLevel, CalculateResult, GoalKind, NutritionPlan, Sex } from "../models";
import { decimalOrNull } from "./profile.js";

/**
 * `POST /v1/nutrition/calculate` — BMR, TDEE and, with a goal, the daily
 * targets.
 *
 * A pure calculation over the numbers sent: Mifflin-St Jeor with both sex
 * constants, times the standard activity multiplier. It names no end user and
 * needs no `setUser`.
 *
 * With `goal` the result carries the whole plan: `energy`, the three macros,
 * `daily_energy_delta`, `weekly_weight_change_kg` and, with `goalWeightKg`,
 * `estimated_days_to_goal`. Without it those are **null** and named in
 * `undecided_fields`. For an end user's stored profile use {@link readPlan}.
 */
export interface CalculateParams {
  readonly age: number;
  readonly heightCm: string | number;
  readonly weightKg: string | number;
  /** Required; the enumeration is closed and nothing is defaulted. */
  readonly sex: Sex;
  readonly activityLevel: ActivityLevel;
  /** `maintain`, `lose`, `recomposition` or `gain`. Anything else is a `400`. */
  readonly goal?: GoalKind | undefined;
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

export interface PlanReadOptions {
  /** IANA zone that decides today, for the age. Omitted is UTC. */
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `GET /v1/nutrition/plan` — this end user's daily targets, worked out by the
 * server from their stored profile and current weight.
 *
 * A profile that is not complete is not an error: the plan comes back with
 * `ready: false`, every figure null, and `missing` naming what to ask for.
 * Reading a plan sets nothing; when the user accepts it, store it:
 *
 * ```ts
 * const plan = await trackcore.nutrition.plan({ timezone });
 * if (plan.ready) {
 *   await trackcore.diary.setGoal({
 *     targets: plan.targets, timezone, formulaVersion: plan.plan_version, inputs: plan.inputs,
 *   });
 * }
 * ```
 */
export async function readPlan(client: HasTransport, options: PlanReadOptions = {}): Promise<NutritionPlan> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/nutrition/plan",
    query: { timezone: options.timezone },
    signal: options.signal,
  });
  return decodeNutritionPlan(response.body);
}
