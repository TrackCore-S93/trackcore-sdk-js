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

describe("image.foodPhotos and image.fridgePhotos", () => {
  const photo = (n: number) => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, n]), filename: `meal-${n}.jpg`, contentType: "image/jpeg" });
  const found = (label: string) =>
    `{"status":"ok","result_kind":"plated_portions","items":[{"label":"${label}","suggested_quantity":1.0}]}`;
  const NOTHING = '{"status":"no_match","result_kind":"plated_portions","items":[]}';
  const REFUSED =
    '{"error":{"code":"unsupported_image_format","message":"Only image/jpeg and image/png are accepted.","request_id":"req_415","docs_url":"https://docs.trackcore.dev/errors/unsupported_image_format","retry_after_seconds":null,"domain":"image"}}';

  /** A server that answers each photo by its fourth byte, and records what it saw. */
  function server(answer: (n: number) => { status?: number; body: string; delayMs?: number }) {
    const seen: { n: number; url: string }[] = [];
    let inFlight = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      const form = init.body as FormData;
      const image = form.get("image") as Blob;
      const n = new Uint8Array(await image.arrayBuffer())[3] as number;
      seen.push({ n, url: String(input) });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const reply = answer(n);
      await new Promise((resolve) => setTimeout(resolve, reply.delayMs ?? 1));
      inFlight -= 1;
      return {
        status: reply.status ?? 200,
        headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": `req_${n}` }),
        text: async () => reply.body,
      } as unknown as Response;
    };
    return { fetchImpl, seen, peak: () => peak };
  }

  it("sends each photo as its own scan and joins the foods in photo order", async () => {
    // The first photo answers last, so order by arrival would be wrong.
    const { fetchImpl, seen, peak } = server((n) => ({ body: found(`food-${n}`), delayMs: n === 0 ? 30 : 1 }));
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });

    const meal = await client.image.foodPhotos([photo(0), photo(1), photo(2)], { region: "GB" });

    expect(seen.map((s) => s.n).sort()).toEqual([0, 1, 2]);
    for (const s of seen) expect(s.url).toContain("/v1/image/food?region=GB");
    expect(peak()).toBe(2);
    expect(meal.status).toBe("ok");
    expect(meal.result_kind).toBe("plated_portions");
    expect(meal.failed).toBe(0);
    expect((meal.items as { label: string }[]).map((i) => i.label)).toEqual(["food-0", "food-1", "food-2"]);
    expect(meal.photos.map((p) => [p.index, p.status, p.items.length])).toEqual([[0, "ok", 1], [1, "ok", 1], [2, "ok", 1]]);
    // A number is still a Decimal, as on a single-photo result.
    expect((meal.items[0] as unknown as { suggested_quantity: Decimal }).suggested_quantity).toEqual(new Decimal("1.0"));
  });

  it("takes concurrency from 1 to 4 and no further", async () => {
    const one = server(() => ({ body: found("x"), delayMs: 5 }));
    await new TrackCore({ apiKey: SECRET, fetch: one.fetchImpl }).image.foodPhotos([photo(0), photo(1), photo(2)], { concurrency: 1 });
    expect(one.peak()).toBe(1);
    expect(one.seen.map((s) => s.n)).toEqual([0, 1, 2]);

    const many = server(() => ({ body: found("x"), delayMs: 5 }));
    const photos = Array.from({ length: 8 }, (_, n) => photo(n));
    await new TrackCore({ apiKey: SECRET, fetch: many.fetchImpl }).image.foodPhotos(photos, { concurrency: 50 });
    expect(many.peak()).toBe(4);

    const client = new TrackCore({ apiKey: SECRET, fetch: one.fetchImpl });
    await expect(client.image.foodPhotos([photo(0)], { concurrency: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it("keeps the photos that worked when one is refused", async () => {
    const { fetchImpl } = server((n) => (n === 1 ? { status: 415, body: REFUSED } : { body: found(`food-${n}`) }));
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });

    const meal = await client.image.foodPhotos([photo(0), photo(1), photo(2)]);

    expect(meal.status).toBe("ok");
    expect(meal.failed).toBe(1);
    expect((meal.items as { label: string }[]).map((i) => i.label)).toEqual(["food-0", "food-2"]);
    const refused = meal.photos[1];
    expect(refused?.status).toBe("failed");
    expect(refused?.result).toBeNull();
    expect((refused?.error as { code: string }).code).toBe("unsupported_image_format");
    expect((refused?.error as { requestId: string }).requestId).toBe("req_415");
    expect(meal.photos[0]?.error).toBeNull();
  });

  it("throws the first photo's error when every photo failed", async () => {
    const { fetchImpl } = server(() => ({ status: 415, body: REFUSED }));
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    await expect(client.image.foodPhotos([photo(0), photo(1)])).rejects.toMatchObject({ code: "unsupported_image_format" });
  });

  it("is no_match when no photo had a food in it, and says which did", async () => {
    const none = server(() => ({ body: NOTHING }));
    const empty = await new TrackCore({ apiKey: SECRET, fetch: none.fetchImpl }).image.foodPhotos([photo(0), photo(1)]);
    expect(empty.status).toBe("no_match");
    expect(empty.items).toEqual([]);
    expect(empty.photos.map((p) => p.status)).toEqual(["no_match", "no_match"]);

    const mixed = server((n) => ({ body: n === 0 ? NOTHING : found("rice") }));
    const some = await new TrackCore({ apiKey: SECRET, fetch: mixed.fetchImpl }).image.foodPhotos([photo(0), photo(1)]);
    expect(some.status).toBe("ok");
    expect(some.photos.map((p) => p.status)).toEqual(["no_match", "ok"]);
    expect(some.photos[0]?.result?.["status"]).toBe("no_match");
  });

  it("refuses an empty list and more than ten photos before sending anything", async () => {
    const { fetchImpl, seen } = server(() => ({ body: found("x") }));
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    await expect(client.image.foodPhotos([])).rejects.toBeInstanceOf(TypeError);
    const eleven = Array.from({ length: 11 }, (_, n) => photo(n));
    await expect(client.image.foodPhotos(eleven)).rejects.toBeInstanceOf(RangeError);
    expect(seen).toEqual([]);
    const ten = await client.image.foodPhotos(eleven.slice(0, 10));
    expect(ten.photos).toHaveLength(10);
  });

  it("stops sending and throws AbortError when the caller gives up", async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    const fetchImpl: FetchLike = async (_input, init) => {
      const n = new Uint8Array(await ((init.body as FormData).get("image") as Blob).arrayBuffer())[3] as number;
      seen.push(n);
      if (n === 0) controller.abort();
      return await new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener("abort", fail);
      });
    };
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const photos = Array.from({ length: 6 }, (_, n) => photo(n));
    await expect(client.image.foodPhotos(photos, { signal: controller.signal, concurrency: 1 })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(seen).toEqual([0]);
  });

  it("scans a fridge the same way", async () => {
    const { fetchImpl, seen } = server((n) => ({ body: found(`shelf-${n}`) }));
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    const fridge = await client.image.fridgePhotos([photo(0), photo(1)]);
    for (const s of seen) expect(s.url).toContain("/v1/image/fridge");
    expect(fridge.items).toHaveLength(2);
  });
});
