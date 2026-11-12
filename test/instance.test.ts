/**
 * `TrackCore.instance`: configure once, initialize on sign-in, call anywhere.
 * With a publishable key the SDK mints the session itself and renews it when
 * the server says it expired; with a secret key it sets the user instead.
 */

import { describe, expect, it } from "vitest";

import { TrackCore } from "../src/client.js";
import { ConfigurationError } from "../src/errors.js";
import type { FetchLike } from "../src/transport.js";

const PUBLISHABLE = `tc_pk_live_${"B".repeat(43)}`;
const SECRET = `tc_sk_live_${"7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3"}`;

interface Sent {
  path: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function session(token: string): string {
  return `{"session_token":"${token}","external_id":"user_42","expires_at":"2026-11-13T06:00:00Z","issued_at":"2026-11-12T06:00:00Z","ttl_seconds":86400,"environment":"live","token_type":"opaque"}`;
}
const DAY = '{"app_user":"user_42","local_date":"2026-11-12","timezone":"UTC","entries":0,"consumed":{},"goal_snapshot":null,"remaining":null,"partial_sum":false,"water":{"recorded":null,"target":null,"remaining":null,"unit":"ml"},"steps":{"recorded":null,"target":null,"remaining":null,"unit":"count"},"weight_kg":null,"environment":"live"}';
const EXPIRED = '{"error":{"code":"session_expired","message":"The end-user session token has expired.","request_id":"req_x","docs_url":"https://docs.trackcore.dev/errors/session_expired"}}';

function server(answer: (sent: Sent, n: number) => { status: number; body: string }): { fetchImpl: FetchLike; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const record: Sent = {
      path: url.pathname,
      method: init.method ?? "GET",
      headers: new Headers(init.headers as HeadersInit),
      body: init.body === undefined ? null : String(init.body),
    };
    sent.push(record);
    const { status, body } = answer(record, sent.length);
    return {
      status,
      headers: new Headers({ "Content-Type": "application/json", "X-Request-Id": "req_test" }),
      text: async () => body,
    } as unknown as Response;
  };
  return { fetchImpl, sent };
}

describe("TrackCore.instance", () => {
  it("is one object for the whole app", () => {
    expect(TrackCore.instance).toBe(TrackCore.instance);
  });

  it("refuses to be used before configure, and user data before initialize", () => {
    const fresh = new (TrackCore.instance.constructor as new () => typeof TrackCore.instance)();
    expect(() => fresh.foods).toThrow(ConfigurationError);
    fresh.configure({ apiKey: PUBLISHABLE, baseUrl: "http://127.0.0.1:1", fetch: async () => { throw new Error("no"); } });
    expect(() => fresh.foods).not.toThrow();
    try {
      fresh.diary;
      throw new Error("diary was reachable before initialize");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).reason).toBe("not_initialized");
    }
  });

  it("initialize with a publishable key mints the session itself and every call then carries it", async () => {
    const { fetchImpl, sent } = server((s) =>
      s.path === "/v1/auth/session" ? { status: 201, body: session("tc_st_first") } : { status: 200, body: DAY },
    );
    const tc = new (TrackCore.instance.constructor as new () => typeof TrackCore.instance)();
    tc.configure({ apiKey: PUBLISHABLE, baseUrl: "http://api.test", fetch: fetchImpl });
    await tc.initialize("user_42");

    expect(sent[0]!.method).toBe("POST");
    expect(sent[0]!.path).toBe("/v1/auth/session");
    expect(sent[0]!.headers.get("Authorization")).toBe(`Bearer ${PUBLISHABLE}`);
    expect(sent[0]!.body).toBe('{"external_id":"user_42","ttl_seconds":86400}');
    expect(tc.isInitialized).toBe(true);
    expect(tc.externalId).toBe("user_42");

    await tc.diary.day({ date: "2026-11-12" });
    expect(sent[1]!.headers.get("X-TrackCore-Session")).toBe("tc_st_first");
    // The user id is never sent again as a header: the session carries it.
    expect(sent[1]!.headers.get("X-External-Id")).toBeNull();
  });

  it("renews an expired session inside the SDK and completes the call", async () => {
    let minted = 0;
    const { fetchImpl, sent } = server((s) => {
      if (s.path === "/v1/auth/session") return { status: 201, body: session(`tc_st_${++minted}`) };
      return s.headers.get("X-TrackCore-Session") === "tc_st_1" ? { status: 401, body: EXPIRED } : { status: 200, body: DAY };
    });
    const tc = new (TrackCore.instance.constructor as new () => typeof TrackCore.instance)();
    tc.configure({ apiKey: PUBLISHABLE, baseUrl: "http://api.test", fetch: fetchImpl });
    await tc.initialize("user_42");

    const day = await tc.diary.day({ date: "2026-11-12" });
    expect(day.local_date).toBe("2026-11-12");
    expect(sent.map((s) => s.path)).toEqual(["/v1/auth/session", "/v1/diary/day", "/v1/auth/session", "/v1/diary/day"]);
    expect(sent[3]!.headers.get("X-TrackCore-Session")).toBe("tc_st_2");
    expect(minted).toBe(2);
  });

  it("signOut forgets the user and stops renewing", async () => {
    const { fetchImpl, sent } = server((s) =>
      s.path === "/v1/auth/session" ? { status: 201, body: session("tc_st_first") } : { status: 401, body: EXPIRED },
    );
    const tc = new (TrackCore.instance.constructor as new () => typeof TrackCore.instance)();
    tc.configure({ apiKey: PUBLISHABLE, baseUrl: "http://api.test", fetch: fetchImpl });
    await tc.initialize("user_42");
    tc.signOut();
    expect(tc.isInitialized).toBe(false);
    expect(tc.client.sessionToken).toBeNull();
    expect(() => tc.diary).toThrow(ConfigurationError);
    expect(sent).toHaveLength(1);
  });

  it("initialize with a secret key sets the user and mints nothing", async () => {
    const { fetchImpl, sent } = server(() => ({ status: 200, body: DAY }));
    const tc = new (TrackCore.instance.constructor as new () => typeof TrackCore.instance)();
    tc.configure({ apiKey: SECRET, baseUrl: "http://api.test", fetch: fetchImpl });
    await tc.initialize("user_42");
    await tc.diary.day({ date: "2026-11-12" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers.get("X-External-Id")).toBe("user_42");
    expect(sent[0]!.headers.get("X-TrackCore-Session")).toBeNull();
  });
});
