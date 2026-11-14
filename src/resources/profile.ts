import { decodeProfile } from "../decode.js";
import type { HasTransport } from "./foods";
import type { ActivityLevel, GoalKind, Profile, Sex } from "../models";

/**
 * `GET` and `PUT /v1/profile` — the end user's nutrition profile.
 *
 * Sex, date of birth, height, activity level, the direction they are working
 * in and the weight they are working towards. Needs an end user, like the
 * diary: `setUser` on a server, `setSession` on a device.
 *
 * # A PUT is a patch
 *
 * An attribute you do not pass is kept, one passed as `null` is cleared, one
 * passed with a value is set. A screen that asks for height alone sends
 * `{ heightCm: "178" }` and the date of birth survives.
 *
 * # The current weight is not here
 *
 * Log it as a `body_mass` health record with `healthData.log`, so a weight
 * typed into the app and a weight synced from a scale are the same fact in
 * the same place. The profile reads it back as `current_weight_kg`, when the
 * customer may see health data (the `health.sync` entitlement and a DPA).
 */
export interface ProfilePatch {
  readonly sex?: Sex | null | undefined;
  /** `YYYY-MM-DD`, in the past. */
  readonly dateOfBirth?: string | null | undefined;
  /** Centimetres. A string keeps the scale; a number is fine for a whole value. */
  readonly heightCm?: string | number | null | undefined;
  readonly activityLevel?: ActivityLevel | null | undefined;
  readonly goalKind?: GoalKind | null | undefined;
  /** Kilograms. */
  readonly targetWeightKg?: string | number | null | undefined;
  /**
   * `true` marks the app's onboarding flow complete for this end user,
   * stamping the time; `false` or `null` clears the mark. Stated by the app,
   * never inferred by the server. Read it back as `profile.onboarding`.
   */
  readonly onboardingCompleted?: boolean | null | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ProfileReadOptions {
  /** IANA zone that decides which day "today" is for `age`. Omitted means UTC. */
  readonly timezone?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export async function getProfile(client: HasTransport, options?: ProfileReadOptions): Promise<Profile> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/profile",
    query: { timezone: options?.timezone },
    signal: options?.signal,
  });
  return decodeProfile(response.body);
}

export async function setProfile(client: HasTransport, patch: ProfilePatch): Promise<Profile> {
  const body: Record<string, unknown> = {};
  if (patch.sex !== undefined) body["sex"] = patch.sex;
  if (patch.dateOfBirth !== undefined) body["date_of_birth"] = patch.dateOfBirth;
  if (patch.heightCm !== undefined) body["height_cm"] = decimalOrNull(patch.heightCm);
  if (patch.activityLevel !== undefined) body["activity_level"] = patch.activityLevel;
  if (patch.goalKind !== undefined) body["goal_kind"] = patch.goalKind;
  if (patch.targetWeightKg !== undefined) body["target_weight_kg"] = decimalOrNull(patch.targetWeightKg);
  if (patch.onboardingCompleted !== undefined) body["onboarding_completed"] = patch.onboardingCompleted;
  const response = await client.transport.request({
    method: "PUT",
    path: "/v1/profile",
    body,
    signal: patch.signal,
  });
  return decodeProfile(response.body);
}

/**
 * A number the server must read as a JSON number. A string is passed through
 * as a raw numeral so `"178.5"` is sent as `178.5`, never as `"178.5"`, which
 * the server refuses (DM-N1).
 */
export function decimalOrNull(value: string | number | null): unknown {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new TypeError(`not a decimal numeral: ${value}`);
  }
  return rawNumber(value);
}

/** A value `JSON.stringify` writes as the bare numeral. */
function rawNumber(numeral: string): unknown {
  const raw = (JSON as { rawJSON?: (text: string) => unknown }).rawJSON;
  if (typeof raw === "function") return raw(numeral);
  // Without JSON.rawJSON the numeral goes through a double, which is exact
  // for anything a profile holds (one decimal place, under a thousand).
  return Number(numeral);
}
