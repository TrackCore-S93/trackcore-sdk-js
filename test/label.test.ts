/**
 * `POST /v1/label`: the photo goes out as multipart, and the extraction's
 * numbers come back as Decimal.
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { Decimal } from "../src/decimal.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

const EXTRACTION =
  '{"status":"ok","is_product_label":true,"product_name":"Scanned label","brand":null,"food":{"food_type":"custom_food","servings":[{"nutrition":{"energy":{"value":250.000,"unit":"kcal"}}}]},"field_confidence":{"energy":0.90}}';

describe("label.extract", () => {
  it("posts the photo and keeps 250.000", async () => {
    let contentType: string | null = null;
    let sawPhoto = false;
    const fetchImpl: FetchLike = async (_url, init) => {
      contentType = new Headers(init.headers).get("Content-Type");
      const form = init.body;
      if (!(form instanceof FormData)) throw new Error("expected FormData");
      const image = form.get("image");
      if (!(image instanceof Blob)) throw new Error("expected a file");
      const bytes = new Uint8Array(await image.arrayBuffer());
      sawPhoto = bytes.length === 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
        text: async () => EXTRACTION,
      } as unknown as Response;
    };

    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const result = await client.label.extract({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      filename: "label.jpg",
      contentType: "image/jpeg",
    });

    expect(contentType).toBeNull();
    expect(sawPhoto).toBe(true);
    const food = result["food"] as unknown as { servings: { nutrition: { energy: { value: Decimal } } }[] };
    expect(food.servings[0]?.nutrition.energy.value).toEqual(new Decimal("250.000"));
    const confidence = result["field_confidence"] as unknown as { energy: Decimal };
    expect(confidence.energy).toEqual(new Decimal("0.90"));
  });
});
