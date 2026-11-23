import { describe, expect, it } from "vitest";
import { TrackCore } from "../src/client.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

interface Sent {
  url: string;
  method: string;
  body: string;
}

/** A client whose every call is answered with `body`, and what it sent. */
function clientRecording(body: string, status = 200): { client: TrackCore; sent: Sent } {
  const sent: Sent = { url: "", method: "", body: "" };
  const fetchImpl: FetchLike = async (input, init) => {
    sent.url = String(input);
    sent.method = String(init?.method ?? "GET");
    sent.body = typeof init?.body === "string" ? init.body : "";
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => body,
    } as unknown as Response;
  };
  const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
  client.setUser("user_1");
  return { client, sent };
}

const FOOD =
  '{"food_id":"tc_food_1","food_type":"custom_food","name":"Protein bar","brand":null,' +
  '"image_url":"https://cdn.example.com/bar.jpg",' +
  '"servings":[{"serving_id":"tc_srv_1_0","serving_id_version":1,"description":"1 bar","household_unit":null,' +
  '"base_quantity":1,"metric_amount":60.0,"metric_unit":"g","gram_weight_per_household_unit":null,' +
  '"is_metric_default":false,"is_synthesised":false,"nutrition":{"energy":{"value":212.50,"unit":"kcal"}}}],' +
  '"default_serving_id":"tc_srv_1_0",' +
  '"measurements":[{"label":"bar","detail":null,"kind":"portion","serving_id":"tc_srv_1_0",' +
  '"consumed_quantity_per_unit":1,"default_amount":1,"weight_g":60.0,"volume_ml":null,"is_default":true,' +
  '"nutrition":{"energy":{"value":212.50,"unit":"kcal"}}}],' +
  '"data_quality":"ok","ingredients":null,"directions":null,"recipe_servings":null,' +
  '"energy_reconciliation":null,"tolerance_version":null,' +
  '"provenance":{"source":"end_user","upstream_id":null,"upstream_version":null,"fields":{}},' +
  '"updated_at":"2026-11-23T10:00:00Z","etag":"W/\\"abc\\""}';

function clientAnswering(body: string, status = 200): { client: TrackCore; seen: () => string } {
  let url = "";
  const fetchImpl: FetchLike = async (input) => {
    url = String(input);
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => body,
    } as unknown as Response;
  };
  return { client: new TrackCore({ apiKey: SECRET, fetch: fetchImpl }), seen: () => url };
}

describe("the end user's own foods: list, edit, photo", () => {
  it("listOwnFoods returns whole foods and the cursor for the next page", async () => {
    const { client, sent } = clientRecording(
      `{"external_id":"user_1","foods":[${FOOD}],"next_cursor":"bmV4dA","environment":"test"}`,
    );
    const page = await client.diary.listOwnFoods({ limit: 8, cursor: "abc", type: "custom_food" });
    expect(sent.method).toBe("GET");
    expect(sent.url).toContain("/v1/diary/foods?");
    expect(sent.url).toContain("limit=8");
    expect(sent.url).toContain("cursor=abc");
    expect(sent.url).toContain("type=custom_food");
    expect(page.next_cursor).toBe("bmV4dA");
    const food = page.foods[0]!;
    // A row needs no second read: the portion, its numbers and the unit list
    // are all here, and the digits are the server's.
    expect(food.image_url).toBe("https://cdn.example.com/bar.jpg");
    expect(food.servings[0]?.nutrition["energy"]?.value?.toString()).toBe("212.50");
    expect(food.measurements[0]?.label).toBe("bar");
    expect(food.measurements[0]?.consumed_quantity_per_unit.toString()).toBe("1");
  });

  it("listOwnFoods with no parameters asks for the first page, and the last page has a null cursor", async () => {
    const { client, sent } = clientRecording('{"external_id":"user_1","foods":[],"next_cursor":null,"environment":"test"}');
    const page = await client.diary.listOwnFoods();
    expect(sent.url.endsWith("/v1/diary/foods")).toBe(true);
    expect(page.foods).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });

  it("foods.custom.update sends only the keys that were passed", async () => {
    const { client, sent } = clientRecording(FOOD);
    const food = await client.foods.custom.update("tc_food_1", { name: "Protein bar" });
    expect(sent.method).toBe("PATCH");
    expect(sent.url).toContain("/v1/foods/custom/tc_food_1");
    expect(JSON.parse(sent.body)).toEqual({ name: "Protein bar" });
    expect(food.name).toBe("Protein bar");
  });

  it("foods.custom.update sends null to remove a brand or a photo", async () => {
    const { client, sent } = clientRecording(FOOD);
    await client.foods.custom.update("tc_food_1", { brand: null, imageUrl: null });
    expect(JSON.parse(sent.body)).toEqual({ brand: null, image_url: null });
  });

  it("foods.custom.update names the serving an edited one replaces", async () => {
    const { client, sent } = clientRecording(FOOD);
    await client.foods.custom.update("tc_food_1", {
      defaultServingId: "tc_srv_1_0",
      servings: [
        { servingId: "tc_srv_1_0", description: "1 bar", baseQuantity: 1, nutrition: { energy: { value: 215, unit: "kcal" } } },
        { description: "half bar", baseQuantity: 1, nutrition: { energy: { value: 107.5, unit: "kcal" } } },
      ],
    });
    const body = JSON.parse(sent.body) as { default_serving_id: string; servings: Record<string, unknown>[] };
    expect(body.default_serving_id).toBe("tc_srv_1_0");
    expect(body.servings[0]?.["serving_id"]).toBe("tc_srv_1_0");
    // A new serving carries no id: the server names it.
    expect("serving_id" in body.servings[1]!).toBe(false);
  });

  it("foods.custom.update refuses an edit of nothing before sending it", async () => {
    const { client, sent } = clientRecording(FOOD);
    await expect(client.foods.custom.update("tc_food_1", {})).rejects.toThrow(/nothing to change/);
    await expect(client.foods.custom.update("", { name: "x" })).rejects.toThrow(/food id/);
    expect(sent.url).toBe("");
  });

  it("foods.custom.create sends the photo link", async () => {
    const { client, sent } = clientRecording(FOOD, 201);
    const food = await client.foods.custom.create({
      name: "Protein bar",
      imageUrl: "https://cdn.example.com/bar.jpg",
      servings: [{ description: "1 bar", baseQuantity: 1, nutrition: { energy: { value: 212.5, unit: "kcal" } } }],
    });
    const body = JSON.parse(sent.body) as Record<string, unknown>;
    expect(body["image_url"]).toBe("https://cdn.example.com/bar.jpg");
    expect(food.image_url).toBe("https://cdn.example.com/bar.jpg");
  });
});

describe("own foods and favourites are typed", () => {
  it("searchOwnFoods decodes OwnFoodSearchResults", async () => {
    const { client, seen } = clientAnswering(
      '{"external_id":"user_1","query":"lasagne","results":[{"food_id":"tc_food_1","food_type":"recipe","name":"Mum\u2019s lasagne","brand":null,"default_serving_id":"tc_srv_1","updated_at":"2026-11-14T09:30:00Z"}],"environment":"test"}',
    );
    client.setUser("user_1");
    const found = await client.diary.searchOwnFoods({ q: "lasagne" });
    expect(seen()).toContain("/v1/diary/foods/search?q=lasagne");
    expect(found.query).toBe("lasagne");
    expect(found.results[0]?.food_type).toBe("recipe");
    expect(found.results[0]?.default_serving_id).toBe("tc_srv_1");
  });

  it("addFavourite decodes the card", async () => {
    const { client } = clientAnswering(
      '{"food_id":"tc_food_1","name":"Apples","brand":null,"default_serving_id":"fs:1:1","serving_description":"medium","nutrition":{"energy":{"value":72,"unit":"kcal"}},"favourited_at":"2026-11-14T09:30:00Z","card_refreshed_at":"2026-11-14T09:30:00Z"}',
      201,
    );
    client.setUser("user_1");
    const card = await client.diary.addFavourite("tc_food_1");
    expect(card.name).toBe("Apples");
    expect(card.favourited_at).toBe("2026-11-14T09:30:00Z");
    expect(card.nutrition?.["energy"]?.value?.toString()).toBe("72");
  });
});
