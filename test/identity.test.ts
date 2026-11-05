/**
 * End-user identification: `setUser`, `clearUser`, and the header they govern.
 *
 * Three parts, and the first two are the ones that matter most.
 *
 *   The header half asserts that `X-External-Id` is present with the exact
 *   value on every request after `setUser` — on the GETs **and** on the
 *   body-carrying POSTs, which build their headers through the same code but
 *   are the half nothing used to drive (BUG-024) — and **absent entirely**
 *   before `setUser` and after `clearUser`: not blank, absent.
 *
 *   Absent and blank are in fact the same thing to the gateway, not different
 *   things. `provisionUser` (`services/gateway/internal/httpx/guard.go`) reads
 *   the value with Go's `Header.Get`, which answers `""` for a missing header
 *   and for a present-but-empty one alike, and returns early on `""` in both
 *   cases: no `400`, nobody provisioned. (An earlier version of this comment
 *   claimed a blank header was a `400`. It is not — BUG-028.) The SDK still
 *   omits the header rather than sending it empty, because that gives "no
 *   user" one spelling on the wire instead of two, and these tests pin the
 *   omission rather than the obsolete reason for it.
 *
 *   The validation half asserts that a refusal happens at the call site and
 *   that **no request is issued** — a malformed id that reaches the gateway is
 *   a `400`, but one that reaches it in a *valid-looking* corrupted form is a
 *   second `app_user` row, which nothing fails on and nobody notices.
 *
 *   The contract half binds this SDK's constants and reason slugs to
 *   `sdks/identity-contract.json`, the file the Flutter and React Native
 *   suites read as well, so that a rename on any one of the three stops being
 *   something the other two have to notice by eye.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TrackCore } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import {
  EXTERNAL_ID_HEADER,
  EXTERNAL_ID_MAX_CODE_POINTS,
  assertValidExternalId,
} from "../src/identity.js";
import { MemoryResponseCache } from "../src/cache.js";
import type { ConfigurationErrorReason } from "../src/errors.js";
import type { FetchLike } from "../src/transport.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;
const APPLE_ID = "tc_food_0H0MSKADSH7000000000000000";

/** A minimal body for each POST route, enough to clear its decoder. */
const LABEL_SCAN = '{"status":"ok","is_product_label":false,"food":null}';
const RECOGNITION = '{"status":"ok","result_kind":"plated_portions","items":[]}';
const NLP_RESULT = '{"text":"chicken salad","results":[]}';

/** Answers whichever POST route the call went to. */
function bodyForRoute(url: string): string {
  if (url.includes("/v1/label")) return LABEL_SCAN;
  if (url.includes("/v1/image/")) return RECOGNITION;
  if (url.includes("/v1/nlp")) return NLP_RESULT;
  return "{}";
}

/** Four bytes of JPEG, which is all any of these routes needs to see. */
const PHOTO = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  filename: "label.jpg",
  contentType: "image/jpeg",
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: RequestInit["body"];
}

interface Harness {
  readonly client: TrackCore;
  /** Every call `fetch` was asked to make, in order. */
  readonly calls: Call[];
}

/** Records one call. The headers are **copied**: `#attempt` writes the JSON
 * `Content-Type` onto that same object after `init` is built, and a record a
 * later line can still change is a record of nothing. */
function record(calls: Call[], url: string, init: RequestInit): void {
  calls.push({
    url,
    method: init.method ?? "GET",
    headers: { ...(init.headers as Record<string, string>) },
    body: init.body,
  });
}

/** A client over a `fetch` that answers everything with `body` and records it. */
function harness(body: string | ((url: string) => string) = "{}"): Harness {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    record(calls, url, init);
    return {
      status: 200,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => (typeof body === "string" ? body : body(url)),
    } as unknown as Response;
  };
  return { client: new TrackCore({ apiKey: SECRET, fetch: fetchImpl }), calls };
}

describe("the header", () => {
  it("is absent before setUser", async () => {
    const { client, calls } = harness(fixture("food_detail.json"));
    await client.foods.get(APPLE_ID);

    expect(calls).toHaveLength(1);
    // `toBeUndefined` would also pass for a key present with the value
    // `undefined`, which `fetch` would serialise as the string "undefined".
    expect(Object.keys(calls[0]!.headers)).not.toContain(EXTERNAL_ID_HEADER);
    expect(client.externalId).toBeNull();
  });

  it("carries the exact value after setUser", async () => {
    const { client, calls } = harness(fixture("food_detail.json"));
    client.setUser("firebase_9xKq2LmN4pR7");
    await client.foods.get(APPLE_ID);

    expect(calls[0]!.headers[EXTERNAL_ID_HEADER]).toBe("firebase_9xKq2LmN4pR7");
    expect(client.externalId).toBe("firebase_9xKq2LmN4pR7");
  });

  it("is absent again after clearUser", async () => {
    const { client, calls } = harness(fixture("food_detail.json"));
    client.setUser("user_42");
    await client.foods.get(APPLE_ID);
    client.clearUser();
    await client.foods.get(APPLE_ID);

    expect(calls[0]!.headers[EXTERNAL_ID_HEADER]).toBe("user_42");
    expect(Object.keys(calls[1]!.headers)).not.toContain(EXTERNAL_ID_HEADER);
    expect(client.externalId).toBeNull();
  });

  it("follows the client, not the call: every subsequent request carries it", async () => {
    const { client, calls } = harness(fixture("food_detail.json"));
    client.setUser("user_a");
    await client.foods.get(APPLE_ID);
    await client.foods.search({ q: "apple" });
    client.setUser("user_b");
    await client.foods.get(APPLE_ID);

    expect(calls.map((c) => c.headers[EXTERNAL_ID_HEADER])).toEqual(["user_a", "user_a", "user_b"]);
  });

  it("rides on the health probe too, not only the food resources", async () => {
    const probe = harness('{"status":"ok","version":"0.1.0"}');
    probe.client.setUser("user_probe");
    await probe.client.health();
    expect(probe.calls[0]!.url).toBe("https://api.trackcore.dev/healthz");
    expect(probe.calls[0]!.headers[EXTERNAL_ID_HEADER]).toBe("user_probe");
  });

  it("rides on a conditional request as well as the first one (SDK-O4)", async () => {
    const calls: Call[] = [];
    let served = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      record(calls, url, init);
      const first = served++ === 0;
      return {
        status: first ? 200 : 304,
        headers: new Headers({ "Content-Type": "application/json", ETag: 'W/"tag"' }),
        text: async () => (first ? fixture("food_detail.json") : ""),
      } as unknown as Response;
    };
    const client = new TrackCore({
      apiKey: SECRET,
      fetch: fetchImpl,
      cache: new MemoryResponseCache(),
    });
    client.setUser("user_etag");
    await client.foods.get(APPLE_ID, { revalidate: true });
    await client.foods.get(APPLE_ID, { revalidate: true });

    // The second call is the revalidation — it must still say who is asking,
    // because a 304 is still a metered, attributable request.
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers["If-None-Match"]).toBe('W/"tag"');
    expect(calls[1]!.headers[EXTERNAL_ID_HEADER]).toBe("user_etag");
  });

  it("is never sent empty", async () => {
    const { client, calls } = harness(fixture("food_detail.json"));
    await client.foods.get(APPLE_ID);
    for (const call of calls) {
      expect(Object.values(call.headers)).not.toContain("");
    }
  });
});

/**
 * The POST half of BUG-024.
 *
 * Every test above drives a `GET`. `#attempt` writes the header once, for both
 * verbs, but "one code path" is an argument and not a test: a guard that reads
 * `options.body === undefined && options.rawBody === undefined` alongside the
 * user check deletes the header from exactly the four AI routes — Label AI,
 * Food Scan AI, FridgeAI and Voice→text — and leaves a suite that only ever
 * GETs completely green. That failure is silent in production too: the calls
 * succeed, they are simply attributed to nobody, so it surfaces as a metering
 * hole weeks later rather than as an error. These tests are what kills it.
 */
describe("the header on a body-carrying POST", () => {
  it("rides every POST route, multipart and JSON alike", async () => {
    const { client, calls } = harness(bodyForRoute);
    client.setUser("user_post");

    await client.label.extract(PHOTO);
    await client.image.food(PHOTO);
    await client.image.fridge(PHOTO);
    await client.nlp.fromSpeech({ bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), filename: "s.wav" });
    await client.nlp.search("chicken salad");

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.method, `${call.url} was not a POST`).toBe("POST");
      expect(call.headers[EXTERNAL_ID_HEADER], `${call.url} lost the header`).toBe("user_post");
    }
    // Named explicitly as well as in the loop, so a resource that stops being
    // called at all cannot pass by shrinking the set it iterates.
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/label",
      "/v1/image/food",
      "/v1/image/fridge",
      "/v1/nlp",
      "/v1/nlp",
    ]);
  });

  it("the multipart POST carries the id beside its own generated Content-Type", async () => {
    // The SDK deliberately does **not** set `Content-Type` on a multipart body:
    // only the platform can write the boundary, and a hand-set value without
    // one makes the body unparseable at the far end. So the JS equivalent of
    // Flutter's `startsWith('multipart/form-data')` assertion is to hand `init`
    // to a real `Request`, which is what the runtime does next, and read the
    // headers the gateway would actually see. Both have to be there: an
    // identity header that arrived by clobbering the content type would be a
    // worse bug than the one this test exists for.
    const seen: Headers[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(new Request(url, init).headers);
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        text: async () => LABEL_SCAN,
      } as unknown as Response;
    };
    const client = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    client.setUser("user_multipart");
    await client.label.extract(PHOTO);

    expect(seen).toHaveLength(1);
    const headers = seen[0]!;
    expect(headers.get(EXTERNAL_ID_HEADER)).toBe("user_multipart");
    expect(headers.get("Content-Type")).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("the JSON POST carries the id beside application/json and its body", async () => {
    const { client, calls } = harness(bodyForRoute);
    client.setUser("user_json");
    await client.nlp.search("chicken salad");

    const call = calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.headers[EXTERNAL_ID_HEADER]).toBe("user_json");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toBe('{"text":"chicken salad"}');
  });

  it("is absent from a POST before setUser and after clearUser", async () => {
    const { client, calls } = harness(bodyForRoute);
    await client.nlp.search("before");
    client.setUser("user_post");
    await client.nlp.search("during");
    client.clearUser();
    await client.label.extract(PHOTO);

    expect(Object.keys(calls[0]!.headers)).not.toContain(EXTERNAL_ID_HEADER);
    expect(calls[1]!.headers[EXTERNAL_ID_HEADER]).toBe("user_post");
    expect(Object.keys(calls[2]!.headers)).not.toContain(EXTERNAL_ID_HEADER);
    // And nothing on the POST path ever went out blank, which is the shape the
    // SDK promises for "no user" (BUG-028: blank and absent mean the same
    // thing at the gateway, so the promise is about the wire, not about a 400).
    for (const call of calls) {
      expect(Object.values(call.headers)).not.toContain("");
    }
  });
});

describe("validation", () => {
  /** Calls `setUser` and asserts it threw the named reason without fetching. */
  async function refuses(value: unknown, reason: ConfigurationErrorReason): Promise<void> {
    const { client, calls } = harness();
    let thrown: unknown;
    try {
      client.setUser(value as string);
    } catch (error) {
      thrown = error;
    }
    expect(thrown, `${reason} did not throw`).toBeInstanceOf(ConfigurationError);
    expect((thrown as ConfigurationError).reason).toBe(reason);
    // The point of validating synchronously: nothing left the process.
    expect(calls).toHaveLength(0);
    // And the client is unchanged — a refused id does not half-apply.
    expect(client.externalId).toBeNull();
  }

  it("refuses leading or trailing whitespace rather than trimming it", async () => {
    await refuses(" user_1", "external_id_untrimmed");
    await refuses("user_1 ", "external_id_untrimmed");
    await refuses("user_1\n", "external_id_untrimmed");
    // Whitespace only trips the padding rule first, exactly as the gateway's
    // `validExternalID` does — it is padded before it is empty.
    await refuses("   ", "external_id_untrimmed");
  });

  it("refuses the empty string", async () => {
    await refuses("", "external_id_empty");
  });

  it("refuses anything that is not a string", async () => {
    await refuses(undefined, "external_id_not_a_string");
    await refuses(42, "external_id_not_a_string");
    await refuses({ id: "user_1" }, "external_id_not_a_string");
  });

  it("refuses null rather than treating it as a sign-out", async () => {
    // `null` is how the *transport* is told to clear, so delegating blindly
    // would make `setUser(null)` from untyped JavaScript sign the user out
    // instead of failing. `clearUser()` is the only way to clear.
    await refuses(null, "external_id_not_a_string");

    const { client } = harness();
    client.setUser("user_1");
    expect(() => client.setUser(null as unknown as string)).toThrowError(ConfigurationError);
    expect(client.externalId).toBe("user_1");
  });

  it("255 code points passes and 256 does not", async () => {
    const { client } = harness();
    client.setUser("a".repeat(EXTERNAL_ID_MAX_CODE_POINTS));
    expect(client.externalId).toHaveLength(255);
    await refuses("a".repeat(EXTERNAL_ID_MAX_CODE_POINTS + 1), "external_id_too_long");
  });

  it("measures length in code points, not UTF-16 units", async () => {
    // 255 astral-plane code points — 510 UTF-16 code units. `.length` would
    // call this 510 and reject it as too long; `[...value].length` calls it
    // 255, which is what Go's `utf8.RuneCountInString` counts. It gets past
    // the length rule and is then refused for not being ASCII, which is the
    // only way to tell the two implementations apart.
    const astral = "😀".repeat(EXTERNAL_ID_MAX_CODE_POINTS);
    expect(astral.length).toBe(510);
    expect([...astral]).toHaveLength(255);
    await refuses(astral, "external_id_not_ascii");

    // The same string one code point longer is too long, which proves the
    // length rule is reached at all rather than being short-circuited.
    await refuses("😀".repeat(EXTERNAL_ID_MAX_CODE_POINTS + 1), "external_id_too_long");
  });

  it("refuses non-ASCII that an HTTP header would silently corrupt", async () => {
    // U+00E9 is the dangerous case: `fetch` accepts it and sends one Latin-1
    // byte, so the gateway stores a different id and provisions a second user.
    await refuses("user_café", "external_id_not_ascii");
    // Above U+00FF `fetch` throws a bare TypeError instead, which is louder but
    // lands far from the call site.
    await refuses("ユーザー_1", "external_id_not_ascii");
    // Control characters are ASCII but not printable, and `\r\n` in particular
    // is header injection.
    await refuses("user\u0000", "external_id_not_ascii");
    await refuses("user\u007f", "external_id_not_ascii");
  });

  it("accepts the id shapes customers actually have", () => {
    const { client } = harness();
    for (const id of [
      "9xKq2LmN4pR7sT1vW3yZ5bD8gH0j", // Firebase UID
      "018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b", // UUID
      "01HQ8ZJX5K9M2N4P6R8T0V2W4Y", // ULID
      "1",
      "ada@example.com",
      "tenant:eu-west/user#42",
    ]) {
      expect(() => client.setUser(id), id).not.toThrow();
      expect(client.externalId).toBe(id);
    }
  });

  it("no rejection message repeats the id", () => {
    // An external_id is the customer's own user identifier and is often an
    // email. `src/errors.ts` keeps response bodies out of error messages for
    // the same reason: a message ends up in a log aggregator.
    const secretish = "ada.lovelace@example.comé";
    let message = "";
    try {
      assertValidExternalId(secretish);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("ada.lovelace");
    // It names the offending code point instead, which is what you need.
    expect(message).toContain("U+00E9");
  });
});

describe("the transport refuses the same values the client does", () => {
  it("setExternalId validates, so reaching past the client changes nothing", () => {
    const { client } = harness();
    expect(() => client.transport.setExternalId(" padded")).toThrowError(ConfigurationError);
    expect(client.transport.externalId).toBeNull();
    // null is the clear, and is the one value that skips validation.
    client.transport.setExternalId("user_1");
    client.transport.setExternalId(null);
    expect(client.externalId).toBeNull();
  });
});

/**
 * Parity with `sdks/identity-contract.json`.
 *
 * The header name, the 255 limit and the four shared reason slugs are supposed
 * to be identical in the JavaScript, Flutter and React Native SDKs. Until this
 * block existed, that was held together by three teams independently typing the
 * same literals into three suites: rename a slug here, update the literal in
 * this file, and the JS suite stays green while Flutter drifts in silence.
 *
 * The fixture is the shared end of the binding. The literal assertions above
 * stay exactly as they were — this is an additional anchor, not a replacement,
 * and a test that only compared the SDK to a file both sides of a rename could
 * edit would be worth very little on its own.
 */
describe("the shared cross-SDK identity contract", () => {
  interface IdentityContract {
    readonly headerName: string;
    readonly maxCodePoints: number;
    readonly minCodePoint: number;
    readonly maxCodePointValue: number;
    readonly reasons: Readonly<Record<string, string>>;
    readonly javascriptOnlyReasons: Readonly<Record<string, string>>;
  }

  const CONTRACT = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "identity-contract.json"), "utf8"),
  ) as IdentityContract;

  /** The slugs in one group. `$comment` keys are documentation, not values. */
  const slugs = (group: Readonly<Record<string, string>>): string[] =>
    Object.entries(group)
      .filter(([key]) => !key.startsWith("$"))
      .map(([, value]) => value)
      .sort();

  /** `setUser(value)`'s reason, or a failure if it was accepted. */
  function reasonFor(value: unknown): string {
    const { client } = harness();
    try {
      client.setUser(value as string);
    } catch (error) {
      if (error instanceof ConfigurationError) return error.reason;
      throw error;
    }
    throw new Error("setUser accepted a value the contract says it must refuse");
  }

  it("spells the header the way the contract does", () => {
    expect(EXTERNAL_ID_HEADER).toBe(CONTRACT.headerName);
  });

  it("enforces the contract's length ceiling, counted the contract's way", async () => {
    expect(EXTERNAL_ID_MAX_CODE_POINTS).toBe(CONTRACT.maxCodePoints);

    const { client } = harness();
    client.setUser("a".repeat(CONTRACT.maxCodePoints));
    expect(client.externalId).toHaveLength(CONTRACT.maxCodePoints);
    expect(reasonFor("a".repeat(CONTRACT.maxCodePoints + 1))).toBe(CONTRACT.reasons["tooLong"]);
  });

  it("enforces the contract's code-point bounds at both ends", () => {
    const at = (code: number): string => `a${String.fromCodePoint(code)}b`;
    const { client } = harness();

    // Inside the bounds, including the boundary values themselves. U+0020 is
    // only refused as *padding*, which is a different rule, so it is tested
    // here in the interior of an id where the padding rule does not apply.
    client.setUser(at(CONTRACT.minCodePoint));
    client.setUser(at(CONTRACT.maxCodePointValue));

    // One step outside each end.
    expect(reasonFor(at(CONTRACT.minCodePoint - 1))).toBe(CONTRACT.reasons["notAscii"]);
    expect(reasonFor(at(CONTRACT.maxCodePointValue + 1))).toBe(CONTRACT.reasons["notAscii"]);
  });

  it("throws exactly the slugs the contract names, and no others", () => {
    const thrown = {
      untrimmed: reasonFor(" user_1"),
      empty: reasonFor(""),
      tooLong: reasonFor("a".repeat(CONTRACT.maxCodePoints + 1)),
      notAscii: reasonFor("user_café"),
      notAString: reasonFor(42),
    };

    // Each slug, by name, so a swap between two of them is caught as well as a
    // rename of one.
    expect(thrown.untrimmed).toBe(CONTRACT.reasons["untrimmed"]);
    expect(thrown.empty).toBe(CONTRACT.reasons["empty"]);
    expect(thrown.tooLong).toBe(CONTRACT.reasons["tooLong"]);
    expect(thrown.notAscii).toBe(CONTRACT.reasons["notAscii"]);
    // The fifth is unreachable in Dart — `setUser(String)` rules it out at
    // compile time — so the contract marks it JS-only and Flutter's not having
    // it is parity rather than an omission.
    expect(thrown.notAString).toBe(CONTRACT.javascriptOnlyReasons["notAString"]);

    expect(Object.values(thrown).sort()).toEqual(
      [...slugs(CONTRACT.reasons), ...slugs(CONTRACT.javascriptOnlyReasons)].sort(),
    );
  });

  it("declares no external_id reason the contract has not heard of", () => {
    // The set equality above is between the contract and the five values this
    // file drives, so a sixth slug added to the union and never driven would
    // slip past it. The union is the SDK's own declaration of what it can
    // throw, so it is read directly. `test/spec-parity.test.ts` reads
    // `src/errors.ts` the same way.
    const source = readFileSync(join(import.meta.dirname, "..", "src", "errors.ts"), "utf8");
    const declared = [...source.matchAll(/"(external_id_[a-z_]+)"/g)].map((match) => match[1]!);

    expect(new Set(declared).size).toBeGreaterThan(0);
    expect([...new Set(declared)].sort()).toEqual(
      [...slugs(CONTRACT.reasons), ...slugs(CONTRACT.javascriptOnlyReasons)].sort(),
    );
  });
});
