/**
 * Envelope → typed error (SDK-C3), over envelopes produced by `libs/contract`
 * itself rather than hand-written ones.
 *
 * The last block is the one that matters most: **no byte of an unrecognised
 * body reaches an error message.** The backend guarantees no upstream message
 * leaks (PF-X1, PF-X3, PF-B7); it would be absurd for the SDK to undo that by
 * splicing a failed response into `new Error(...)`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AuthenticationError,
  DependencyError,
  MaintenanceError,
  ProtocolError,
  RateLimitError,
  RequestError,
  ResourceError,
  TrackCoreAPIError,
  errorFromEnvelope,
  isAPIError,
  isErrorOfCode,
  isTrackCoreError,
} from "../src/errors.js";
import { parseJson } from "../src/json.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const envelope = (name: string): unknown => parseJson(readFileSync(join(FIXTURES, name), "utf8"));

describe("captured envelopes map to the right class", () => {
  it("410 food_gone is a ResourceError", () => {
    const error = errorFromEnvelope(envelope("err_food_gone.json") as never, 410, "hdr");
    expect(error).toBeInstanceOf(ResourceError);
    expect(error?.code).toBe("food_gone");
    expect(error?.status).toBe(410);
    expect(error?.category).toBe("resource");
    expect(error?.message).toBe("This food is no longer resolvable from its provider.");
    expect(error?.requestId).toBe("2fb3dcbd46507ff587a786c683bd5dad");
    expect(error?.docsUrl).toBe("https://docs.trackcore.dev/errors/food_gone");
    expect(error?.retryAfterSeconds).toBeNull();
    expect(error?.isTransient).toBe(false);
  });

  it("400 query_too_short is a RequestError and carries `limit` as a number", () => {
    const error = errorFromEnvelope(envelope("err_query_too_short.json") as never, 400, null);
    expect(error).toBeInstanceOf(RequestError);
    expect(error?.code).toBe("query_too_short");
    expect(error?.message).toBe("The search query is shorter than 2 characters.");
    expect(error?.fields).toEqual({ limit: 2 });
    expect(typeof error?.fields.limit).toBe("number");
  });

  it("502 upstream_unavailable is a DependencyError naming the upstream", () => {
    const error = errorFromEnvelope(envelope("err_upstream_unavailable.json") as never, 502, null);
    expect(error).toBeInstanceOf(DependencyError);
    expect(error?.code).toBe("upstream_unavailable");
    expect(error?.fields.upstream).toBe("fatsecret");
    expect(error?.isTransient).toBe(true);
    // PF-X3: `upstream` is a provider or service name only — never a status, a
    // URL or a provider message.
    expect(error?.fields.upstream).not.toMatch(/https?:|\d{3}/);
  });

  it("429 rate_limited is a RateLimitError carrying retry_after_seconds", () => {
    const error = errorFromEnvelope(envelope("err_rate_limited.json") as never, 429, null);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error?.retryAfterSeconds).toBe(30);
    expect(error?.isTransient).toBe(true);
  });

  it("503 capability_maintenance is its own class (SDK-O5)", () => {
    const error = errorFromEnvelope(envelope("err_capability_maintenance.json") as never, 503, null);
    // The split a customer builds a maintenance banner on: 503 = we turned it
    // off, 502 = it broke. Catching MaintenanceError must not catch an outage.
    expect(error).toBeInstanceOf(MaintenanceError);
    expect(error).not.toBeInstanceOf(DependencyError);
    expect(error?.code).toBe("capability_maintenance");
    expect(error?.fields.capability).toBe("nutrition.search");
    expect(error?.retryAfterSeconds).toBe(600);
  });

  it("401 credential_malformed is an AuthenticationError", () => {
    const error = errorFromEnvelope(envelope("err_credential_malformed.json") as never, 401, null);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(error?.code).toBe("credential_malformed");
  });
});

describe("narrowing", () => {
  it("isErrorOfCode narrows to one code", () => {
    const error = errorFromEnvelope(envelope("err_food_gone.json") as never, 410, null);
    expect(isTrackCoreError(error)).toBe(true);
    expect(isAPIError(error)).toBe(true);
    expect(isErrorOfCode(error, "food_gone")).toBe(true);
    expect(isErrorOfCode(error, "rate_limited")).toBe(false);
    expect(isTrackCoreError(new Error("plain"))).toBe(false);
  });

  it("survives a bundler renaming the classes", () => {
    const error = errorFromEnvelope(envelope("err_food_gone.json") as never, 410, null);
    expect(error?.isTrackCoreError).toBe(true);
  });

  it("toString names the code and the request id", () => {
    const error = errorFromEnvelope(envelope("err_food_gone.json") as never, 410, null);
    expect(String(error)).toContain("[food_gone]");
    expect(String(error)).toContain("2fb3dcbd46507ff587a786c683bd5dad");
  });
});

describe("a body that is not a conforming envelope is refused, not guessed at", () => {
  const notEnvelopes = [
    "null",
    '"a string"',
    "[]",
    "{}",
    '{"error":null}',
    '{"error":"boom"}',
    '{"error":{"message":"no code"}}',
    '{"error":{"code":"made_up_code","message":"hi"}}',
    '{"error":{"code":"food_gone"}}',
    '{"message":"not wrapped"}',
  ];

  for (const body of notEnvelopes) {
    it(`refuses ${body}`, () => {
      expect(errorFromEnvelope(parseJson(body) as never, 500, null)).toBeNull();
    });
  }

  it("an unknown code is a protocol violation, not a passthrough", () => {
    // The enumeration is closed. A code we do not recognise is evidence this
    // response did not come from TrackCore — a proxy, a WAF, a captive portal.
    expect(errorFromEnvelope(parseJson('{"error":{"code":"teapot","message":"x"}}') as never, 418, null)).toBeNull();
  });
});

describe("no upstream text ever reaches an error message", () => {
  const hostile =
    '<html><body>Gateway error: upstream connect to 10.0.3.14:8080 failed; ' +
    'key=sk_live_SUPERSECRET; SELECT * FROM api_key WHERE id=1</body></html>';

  it("a ProtocolError message is fixed text", () => {
    const error = new ProtocolError("TrackCore answered 502 but not in the documented error envelope.", {
      status: 502,
      requestId: null,
      body: hostile,
    });
    for (const secret of ["10.0.3.14", "sk_live_SUPERSECRET", "SELECT", "<html>"]) {
      expect(error.message, secret).not.toContain(secret);
      expect(String(error), secret).not.toContain(secret);
      expect(error.stack ?? "", secret).not.toContain(secret);
    }
  });

  it("the body does not travel through serialisation or a spread", () => {
    const error = new ProtocolError("fixed", { status: 502, requestId: null, body: hostile });
    expect(JSON.stringify({ ...error })).not.toContain("SUPERSECRET");
    expect(Object.keys(error)).not.toContain("bodySample");
    expect(Object.entries(error).map(([, v]) => String(v)).join()).not.toContain("SUPERSECRET");
  });

  it("but is there for a developer who asks for it by name", () => {
    const error = new ProtocolError("fixed", { status: 502, requestId: null, body: hostile });
    expect(error.bodySample).toContain("Gateway error");
  });

  it("the sample is bounded", () => {
    const error = new ProtocolError("fixed", { status: 502, requestId: null, body: "x".repeat(100_000) });
    expect(error.bodySample).toHaveLength(2048);
  });
});

describe("status versus code", () => {
  it("the code wins when a proxy has rewritten the status", () => {
    // A valid code cannot be invented by a middlebox; a status can be rewritten
    // by one. So `category` — which decides the class a customer catches — is
    // taken from the catalogue.
    const error = errorFromEnvelope(envelope("err_food_gone.json") as never, 200, null);
    expect(error).toBeInstanceOf(ResourceError);
    expect(error?.code).toBe("food_gone");
    expect(error).toBeInstanceOf(TrackCoreAPIError);
  });
});
