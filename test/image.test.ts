/**
 * `POST /v1/image/food` and `POST /v1/image/fridge`: the photo goes out as
 * multipart, and FatSecret's numbers come back as Decimal.
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { Decimal } from "../src/decimal.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

const RECOGNITION =
  '{"status":"ok","result_kind":"plated_portions","items":[{"label":"Apples","confidence":null,"suggested_serving_id":"fs:35718:1","suggested_quantity":1.0,"food":{"servings":[{"nutrition":{"energy":{"value":138.000,"unit":"kcal"}}}]}}]}';

describe("image.food and image.fridge", () => {
  it("posts the photo and keeps 138.000", async () => {
    let url = "";
    let sawPhoto = false;
    const fetchImpl: FetchLike = async (input, init) => {
      url = String(input);
      const form = init.body;
      if (!(form instanceof FormData)) throw new Error("expected FormData");
      const image = form.get("image");
      if (!(image instanceof Blob)) throw new Error("expected a file");
      const bytes = new Uint8Array(await image.arrayBuffer());
      sawPhoto = bytes.length === 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
        text: async () => RECOGNITION,
      } as unknown as Response;
    };

    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const photo = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      filename: "meal.jpg",
      contentType: "image/jpeg",
    };
    const food = await client.image.food(photo, { region: "US", language: "en" });
    expect(url).toContain("/v1/image/food?");
    expect(url).toContain("region=US");
    expect(url).toContain("language=en");
    expect(sawPhoto).toBe(true);
    const items = food["items"] as unknown as { suggested_quantity: Decimal; food: { servings: { nutrition: { energy: { value: Decimal } } }[] } }[];
    const item = items[0];
    if (item === undefined) throw new Error("missing food");
    expect(item.food.servings[0]?.nutrition.energy.value).toEqual(new Decimal("138.000"));
    expect(item.suggested_quantity).toEqual(new Decimal("1.0"));

    const fridge = await client.image.fridge(photo);
    expect(url).toContain("/v1/image/fridge");
    expect(fridge["items"]).toBeDefined();
  });
});
