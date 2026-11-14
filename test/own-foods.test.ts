import { describe, expect, it } from "vitest";
import { TrackCore } from "../src/client.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = "tc_sk_test_" + "a".repeat(32);

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
