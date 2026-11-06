/**
 * `DELETE /v1/users/{external_id}` through the client (PF-T5).
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { ConfigurationError, ResourceError } from "../src/errors.js";
import type { FetchLike } from "../src/transport.js";

const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

const RECEIPT = JSON.stringify({
  external_id: "user_42",
  status: "completed",
  requested_at: "2026-11-06T10:00:00Z",
  completed_at: "2026-11-06T10:00:00Z",
  deleted: { app_user: 1, app_user_session: 2, diary_entry: 1842, meal: 611, health_record: 0 },
  replayed: false,
  request_id: "req_01",
  environment: "live",
});

function client(body: string, status = 200): { client: TrackCore; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_01" }),
      text: async () => body,
    } as unknown as Response;
  };
  return { client: new TrackCore({ apiKey: SECRET, fetch: fetchImpl }), calls };
}

describe("users.delete", () => {
  it("sends a DELETE to /v1/users/{external_id} and reads the receipt", async () => {
    const { client: tc, calls } = client(RECEIPT);
    const receipt = await tc.users.delete("user_42");

    expect(calls).toEqual([{ url: "https://api.trackcore.dev/v1/users/user_42", method: "DELETE" }]);
    expect(receipt.external_id).toBe("user_42");
    expect(receipt.status).toBe("completed");
    expect(receipt.replayed).toBe(false);
    expect(receipt.deleted["diary_entry"]).toBe(1842);
    // A zero count is a count, not an absence.
    expect(receipt.deleted["health_record"]).toBe(0);
    expect(receipt.environment).toBe("live");
  });

  it("does not depend on setUser and does not send X-External-Id", async () => {
    let sentHeader: string | null | undefined;
    const fetchImpl: FetchLike = async (_url, init) => {
      sentHeader = new Headers(init?.headers).get("X-External-Id");
      return {
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        text: async () => RECEIPT,
      } as unknown as Response;
    };
    const tc = new TrackCore({ apiKey: SECRET, fetch: fetchImpl });
    await tc.users.delete("user_42");
    expect(sentHeader).toBeNull();
  });

  it("percent-encodes an id that needs it", async () => {
    const { client: tc, calls } = client(RECEIPT);
    await tc.users.delete("alice@example.com");
    expect(calls[0]?.url).toBe("https://api.trackcore.dev/v1/users/alice%40example.com");
  });

  it("refuses a padded id before anything is sent, with the shared reason", async () => {
    const { client: tc, calls } = client(RECEIPT);
    await expect(tc.users.delete(" user_42")).rejects.toMatchObject({
      name: "ConfigurationError",
      reason: "external_id_untrimmed",
    });
    await expect(tc.users.delete(" user_42")).rejects.toBeInstanceOf(ConfigurationError);
    expect(calls).toHaveLength(0);
  });

  it("surfaces user_not_found as a ResourceError", async () => {
    const { client: tc } = client(
      JSON.stringify({
        error: { code: "user_not_found", message: "No such end-user.", request_id: "req_01" },
      }),
      404,
    );
    await expect(tc.users.delete("never_seen")).rejects.toBeInstanceOf(ResourceError);
    await expect(tc.users.delete("never_seen")).rejects.toMatchObject({ code: "user_not_found" });
  });

  it("reads a replayed receipt as such", async () => {
    const { client: tc } = client(RECEIPT.replace('"replayed":false', '"replayed":true'));
    const receipt = await tc.users.delete("user_42");
    expect(receipt.replayed).toBe(true);
  });
});
