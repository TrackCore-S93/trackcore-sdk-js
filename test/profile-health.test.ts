/**
 * The profile, goals with water and steps, and health values (0019): the
 * requests are the shapes the contract documents, and the answers keep
 * decimals as `Decimal` and counters as `number`.
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { Decimal } from "../src/decimal.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

interface Sent {
  url: string;
  method: string;
  body: string | null;
  headers: Headers;
}

function server(reply: string, status = 200): { client: TrackCore; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    sent.push({
      url: String(input),
      method: init.method ?? "GET",
      body: init.body === undefined ? null : String(init.body),
      headers: new Headers(init.headers as HeadersInit),
    });
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => reply,
    } as unknown as Response;
  };
  const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
  client.setUser("user_123");
  return { client, sent };
}

const PROFILE =
  '{"external_id":"user_123","sex":"female","date_of_birth":"1990-11-12","age":35,"height_cm":170.3,' +
  '"activity_level":"moderate","goal_kind":"lose","target_weight_kg":65.0,' +
  '"current_weight_kg":{"value":72.4,"unit":"kg","measured_on":"2026-11-10"},' +
  '"updated_at":"2026-11-11T09:00:00Z","environment":"live"}';

describe("profile", () => {
  it("sends only the attributes given, null to clear, and keeps the decimals", async () => {
    const { client, sent } = server(PROFILE);
    const profile = await client.profile.set({ sex: "female", heightCm: "170.3", targetWeightKg: null });
    expect(sent[0]!.method).toBe("PUT");
    expect(sent[0]!.url).toContain("/v1/profile");
    expect(sent[0]!.headers.get("X-External-Id")).toBe("user_123");
    // height is a bare number, target weight an explicit null, nothing else.
    expect(sent[0]!.body).toBe('{"sex":"female","height_cm":170.3,"target_weight_kg":null}');

    expect(profile.age).toBe(35);
    expect(profile.height_cm).toEqual(new Decimal("170.3"));
    expect(profile.target_weight_kg).toEqual(new Decimal("65.0"));
    expect(profile.current_weight_kg?.value).toEqual(new Decimal("72.4"));
    expect(profile.current_weight_kg?.measured_on).toBe("2026-11-10");
  });

  it("reads with the zone that decides today", async () => {
    const { client, sent } = server(PROFILE.replace('"age":35', '"age":null'));
    const profile = await client.profile.get({ timezone: "Asia/Karachi" });
    expect(sent[0]!.url).toContain("/v1/profile?timezone=Asia%2FKarachi");
    expect(profile.age).toBeNull();
  });

  it("refuses a numeral that is not a number before sending", async () => {
    const { client, sent } = server(PROFILE);
    await expect(client.profile.set({ heightCm: "tall" })).rejects.toThrow(TypeError);
    expect(sent).toHaveLength(0);
  });
});

const GOAL =
  '{"external_id":"user_123","effective_from":"2026-11-11","targets":{"energy":{"value":2200,"unit":"kcal"},"protein":{"value":120.5,"unit":"g"}},' +
  '"formula_version":"user_customised","inputs":null,"water_ml":2000,"steps":8000,"environment":"live"}';

describe("goals", () => {
  it("sets nutrient, water and step targets from today in the zone", async () => {
    const { client, sent } = server(GOAL);
    const goal = await client.diary.setGoal({
      targets: { energy: { value: 2200, unit: "kcal" }, protein: { value: "120.5", unit: "g" } },
      timezone: "Europe/London",
      waterMl: 2000,
      steps: 8000,
    });
    expect(sent[0]!.method).toBe("PUT");
    expect(sent[0]!.body).toBe(
      '{"timezone":"Europe/London","targets":{"energy":{"value":2200,"unit":"kcal"},"protein":{"value":120.5,"unit":"g"}},"water_ml":2000,"steps":8000}',
    );
    expect(goal.water_ml).toBe(2000);
    expect(goal.steps).toBe(8000);
    expect(goal.targets["protein"]?.value).toEqual(new Decimal("120.5"));
  });

  it("sets the water goal alone, sending nothing else", async () => {
    const { client, sent } = server(GOAL);
    await client.diary.setGoal({ waterMl: 2000, timezone: "Europe/London" });
    expect(sent[0]!.body).toBe('{"timezone":"Europe/London","water_ml":2000}');
    const { client: c2, sent: s2 } = server(GOAL);
    await c2.diary.setGoal({ steps: null, timezone: "Europe/London" });
    expect(s2[0]!.body).toBe('{"timezone":"Europe/London","steps":null}');
  });

  it("reads the goal as it stood on a day", async () => {
    const { client, sent } = server(GOAL);
    await client.diary.goal({ date: "2026-11-01" });
    expect(sent[0]!.url).toContain("/v1/diary/goal?date=2026-11-01");
  });
});

const DAY =
  '{"app_user":"user_123","local_date":"2026-11-11","timezone":"Europe/London","entries":0,"consumed":{},' +
  '"goal_snapshot":null,"goal_snapshot_reason":"no_goal_in_force","remaining":null,"partial_sum":false,' +
  '"water":{"recorded":750,"target":2000,"remaining":1250,"unit":"ml"},' +
  '"steps":{"recorded":null,"target":8000,"remaining":8000,"unit":"count"},' +
  '"weight_kg":{"value":82.4,"unit":"kg","measured_on":"2026-11-09"},"environment":"live"}';

describe("the day's water, steps and weight", () => {
  it("keeps the target a number and the recorded total a Decimal, null apart from zero", async () => {
    const { client } = server(DAY);
    const day = await client.diary.day({ date: "2026-11-11" });
    expect(day.water.target).toBe(2000);
    expect(day.water.recorded).toEqual(new Decimal("750"));
    expect(day.water.remaining).toEqual(new Decimal("1250"));
    expect(day.steps.recorded).toBeNull();
    expect(day.steps.target).toBe(8000);
    expect(day.weight_kg?.value).toEqual(new Decimal("82.4"));
  });
});

const UPLOAD =
  '{"external_id":"user_123","accepted":2,"duplicates_ignored":1,"rejected":1,' +
  '"rejections":[{"index":3,"code":"out_of_range","parameter":"value"}],' +
  '"sync_cursor":{"water":"2026-11-11T13:00:00Z"},"replayed":false,"environment":"live"}';

describe("health values", () => {
  it("logs a manual entry as a batch of one with the app platform and a replay key", async () => {
    const { client, sent } = server(UPLOAD);
    const result = await client.healthData.log({
      records: [{ type: "water", value: 250, startAt: "2026-11-11T08:00:00Z" }],
      timezone: "Europe/London",
      idempotencyKey: "glass-1",
    });
    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.url).toContain("/v1/health/records");
    expect(sent[0]!.headers.get("Idempotency-Key")).toBe("glass-1");
    expect(sent[0]!.body).toBe(
      '{"platform":"app","records":[{"type":"water","value":250,"start_at":"2026-11-11T08:00:00Z"}],"timezone":"Europe/London"}',
    );
    expect(result.accepted).toBe(2);
    expect(result.rejections[0]?.index).toBe(3);
    expect(result.rejections[0]?.code).toBe("out_of_range");
  });

  it("logs a value with no time, which the server stamps as now", async () => {
    const { client, sent } = server(UPLOAD);
    await client.healthData.log({ records: [{ type: "water", value: 250 }] });
    expect(sent[0]!.body).toBe('{"platform":"app","records":[{"type":"water","value":250}]}');
  });

  it("reads records back with a Decimal value and a counted window", async () => {
    const { client, sent } = server(
      '{"external_id":"user_123","from":"2026-10-12T00:00:00Z","to":"2026-11-11T10:00:00Z","records":[' +
        '{"type":"body_mass","record_id":"abc","start_at":"2026-11-11T07:00:00Z","end_at":null,"local_date":"2026-11-11","timezone":"Europe/London",' +
        '"value":82.4,"unit":"kg","source":{"platform":"app","native_type":null,"device":null,"source_app":null},"is_user_entered":true,"recorded_at":null}],' +
        '"environment":"live"}',
    );
    const page = await client.healthData.records({ types: ["body_mass", "water"], limit: 50 });
    expect(sent[0]!.url).toContain("/v1/health/records?types=body_mass%2Cwater&limit=50");
    expect(page.records[0]?.value).toEqual(new Decimal("82.4"));
    expect(page.records[0]?.is_user_entered).toBe(true);
  });

  it("reads daily totals with counters as numbers", async () => {
    const { client, sent } = server(
      '{"external_id":"user_123","from":"2026-11-01","to":"2026-11-11","days":[' +
        '{"local_date":"2026-11-11","values":{"water":{"value":750,"unit":"ml","records":2,"sources":1,"aggregation":"sum"}}}],"environment":"live"}',
    );
    const daily = await client.healthData.daily({ types: ["water"], from: "2026-11-01", to: "2026-11-11" });
    expect(sent[0]!.url).toContain("/v1/health/daily?types=water&from=2026-11-01&to=2026-11-11");
    const water = daily.days[0]!.values["water"]!;
    expect(water.value).toEqual(new Decimal("750"));
    expect(water.records).toBe(2);
    expect(water.sources).toBe(1);
  });

  it("deletes a bounded window and counts what went", async () => {
    const { client, sent } = server('{"external_id":"user_123","deleted":2,"days_recomputed":1,"environment":"live"}');
    const result = await client.healthData.delete({ types: ["water"], from: "2026-11-11T00:00:00Z", to: "2026-11-12T00:00:00Z" });
    expect(sent[0]!.method).toBe("DELETE");
    expect(result.deleted).toBe(2);
    expect(result.days_recomputed).toBe(1);
  });
});

describe("the calculator", () => {
  it("sends the inputs as numbers and reads the undecided targets as null", async () => {
    const { client, sent } = server(
      '{"bmr":{"value":1780,"unit":"kcal"},"tdee":{"value":2759,"unit":"kcal"},"energy":{"value":null,"unit":"kcal"},' +
        '"protein":{"value":null,"unit":"g"},"carbohydrate":{"value":null,"unit":"g","basis":"total"},"fat":{"value":null,"unit":"g"},' +
        '"estimated_days_to_goal":null,"formula_version":"mifflin_st_jeor_v1","activity_multiplier":1.55,' +
        '"undecided_fields":["energy","protein","carbohydrate","fat","estimated_days_to_goal"],"environment":"live"}',
    );
    const result = await client.nutrition.calculate({ age: 34, heightCm: "178", weightKg: "82.4", sex: "male", activityLevel: "moderate" });
    expect(sent[0]!.body).toBe('{"age":34,"height_cm":178,"weight_kg":82.4,"sex":"male","activity_level":"moderate"}');
    expect(result.tdee.value).toEqual(new Decimal("2759"));
    expect(result.energy.value).toBeNull();
    expect(result.estimated_days_to_goal).toBeNull();
    expect(result.activity_multiplier).toEqual(new Decimal("1.55"));
  });
});
