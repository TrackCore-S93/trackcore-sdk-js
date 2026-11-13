/**
 * `POST /v1/nlp`: a transcript searches ten foods, and a recording is the
 * multipart field whisper.cpp transcribes.
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { Decimal } from "../src/decimal.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

const RESULT =
  '{"text":"chicken salad","items":[{"phrase":"chicken salad","quantity":1.5,"unit":"cup","status":"matched","food":{"food_id":"tc_food_1","servings":[{"serving_id":"fs:1:1","nutrition":{"energy":{"value":138.000}}}]},"serving_id":"fs:1:1","consumed_quantity":1.5,"consumed_nutrition":{"energy":{"value":207.000,"unit":"kcal"},"vitamin_d":null}},{"phrase":"zorblax","quantity":null,"unit":null,"status":"no_match","food":null,"serving_id":null,"consumed_quantity":null,"consumed_nutrition":null}],"query":"chicken salad","search_type":"keyword","page":0,"page_size":10,"page_size_clamped":false,"total_results":1,"has_more":false,"results":[{"servings":[{"nutrition":{"energy":{"value":138.000}}}]}]}';

const OLD_RESULT =
  '{"text":"chicken salad","query":"chicken salad","search_type":"keyword","page":0,"page_size":10,"page_size_clamped":false,"total_results":1,"has_more":false,"results":[]}';

describe("nlp", () => {
  it("posts the transcript and keeps 138.000", async () => {
    let url = "";
    let sent = "";
    const fetchImpl: FetchLike = async (input, init) => {
      url = String(input);
      sent = String(init.body);
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
        text: async () => RESULT,
      } as unknown as Response;
    };
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const result = await client.nlp.search("chicken salad");
    expect(url).toContain("/v1/nlp");
    expect(sent).toBe('{"text":"chicken salad"}');
    // Counters are numbers, nutrients and quantities are Decimal with their scale.
    expect(result.page_size).toBe(10);
    expect(result.results[0]?.servings[0]?.nutrition["energy"]?.value).toEqual(new Decimal("138.000"));

    expect(result.items).toHaveLength(2);
    const matched = result.items[0]!;
    expect(matched.status).toBe("matched");
    expect(matched.quantity).toEqual(new Decimal("1.5"));
    expect(matched.unit).toBe("cup");
    expect(matched.serving_id).toBe("fs:1:1");
    expect(matched.consumed_quantity).toEqual(new Decimal("1.5"));
    expect(matched.consumed_nutrition?.["energy"]?.value).toEqual(new Decimal("207.000"));
    // null is kept apart from absent and from zero, in the scaled document too.
    expect(matched.consumed_nutrition?.["vitamin_d"]).toBeNull();

    const miss = result.items[1]!;
    expect(miss.status).toBe("no_match");
    expect(miss.phrase).toBe("zorblax");
    expect(miss.food).toBeNull();
    expect(miss.quantity).toBeNull();
    expect(miss.consumed_nutrition).toBeNull();
  });

  it("reads a response from before itemisation as empty items", async () => {
    const fetchImpl: FetchLike = async () =>
      ({
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        text: async () => OLD_RESULT,
      }) as unknown as Response;
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const result = await client.nlp.search("chicken salad");
    expect(result.items).toEqual([]);
    expect(result.text).toBe("chicken salad");
  });

  it("posts a recording as audio", async () => {
    let saw = false;
    const fetchImpl: FetchLike = async (_input, init) => {
      const form = init.body;
      if (!(form instanceof FormData)) throw new Error("expected FormData");
      const audio = form.get("audio");
      if (!(audio instanceof Blob)) throw new Error("expected a file");
      const bytes = new Uint8Array(await audio.arrayBuffer());
      saw = bytes.length === 4 && bytes[0] === 0x52;
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        text: async () => RESULT,
      } as unknown as Response;
    };
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    await client.nlp.fromSpeech({ bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), filename: "speech.wav" });
    expect(saw).toBe(true);
  });
});

describe("nlp cooking method", () => {
  it("sends cookingMethod as the cooking_method query parameter and reads it back", async () => {
    let url = "";
    let sent = "";
    const fetchImpl: FetchLike = async (input, init) => {
      url = String(input);
      sent = String(init.body);
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
        text: async () =>
          '{"text":"chicken breast","cooking_method":"grilled","items":[],"query":"chicken breast","search_type":"keyword","page":0,"page_size":10,"page_size_clamped":false,"total_results":0,"has_more":false,"results":[]}',
      } as unknown as Response;
    };
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const result = await client.nlp.search("chicken breast", { cookingMethod: "grilled" });
    expect(url).toContain("/v1/nlp?cooking_method=grilled");
    expect(sent).toBe('{"text":"chicken breast"}');
    expect(result.cooking_method).toBe("grilled");
  });
});
