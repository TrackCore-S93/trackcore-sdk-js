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
  '{"text":"chicken salad","query":"chicken salad","search_type":"keyword","page":0,"page_size":10,"page_size_clamped":false,"total_results":1,"has_more":false,"results":[{"servings":[{"nutrition":{"energy":{"value":138.000}}}]}]}';

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
    expect(result["page_size"]).toEqual(new Decimal("10"));
    const rows = result["results"] as unknown as { servings: { nutrition: { energy: { value: Decimal } } }[] }[];
    const energy = rows[0]?.servings[0]?.nutrition.energy.value;
    expect(energy).toEqual(new Decimal("138.000"));
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
