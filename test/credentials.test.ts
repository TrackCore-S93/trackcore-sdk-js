/**
 * SDK-W3: a secret key is rejected in a browser context with a named error.
 *
 * This is the acceptance criterion with the highest real-world cost attached:
 * both of this customer's existing apps shipped an extractable key, and that is
 * the thing the two-key model exists to fix.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { Credential, checkCredential, parseApiKey } from "../src/credentials.js";
import { detectRuntime } from "../src/environment.js";
import { ConfigurationError } from "../src/errors.js";
import { TrackCore } from "../src/client.js";

/** 43 base62 characters — inside the 40..86 the gateway's regex allows. */
const SUFFIX = "7kQ2mF4xT9bR3vN8pL5wC1yH6zJ0dG7sA4eU2iO9kM3";
const SECRET_LIVE = `tc_sk_live_${SUFFIX}`;
const SECRET_TEST = `tc_sk_test_${SUFFIX}`;
const PUBLISHABLE_LIVE = `tc_pk_live_${SUFFIX}`;

/** Installs browser-looking globals for one test. */
function asBrowser(): () => void {
  const fakeDocument = { defaultView: {} };
  const windowValue = { document: fakeDocument };
  vi.stubGlobal("window", windowValue);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("location", { href: "https://app.example.com/" });
  return () => vi.unstubAllGlobals();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseApiKey mirrors services/gateway/internal/keys/tokens.go", () => {
  it("reads kind and environment out of the prefix", () => {
    expect(parseApiKey(SECRET_LIVE)).toMatchObject({
      kind: "secret",
      environment: "live",
      prefix: "tc_sk_live",
      last4: SUFFIX.slice(-4),
    });
    expect(parseApiKey(PUBLISHABLE_LIVE)).toMatchObject({ kind: "publishable", environment: "live" });
    expect(parseApiKey(SECRET_TEST)).toMatchObject({ kind: "secret", environment: "test" });
  });

  it("refuses anything that is not the gateway's token shape", () => {
    for (const bad of [
      "",
      "sk_live_abc",
      "tc_xx_live_" + SUFFIX,
      "tc_sk_prod_" + SUFFIX,
      "tc_sk_live_short",
      `tc_sk_live_${"a".repeat(87)}`,
      // base62 and not base64url: a token that can contain the `_` separator
      // is a parser waiting to disagree with itself.
      `tc_sk_live_${SUFFIX.slice(0, 42)}_`,
      `tc_sk_live_${SUFFIX.slice(0, 42)}-`,
      ` tc_sk_live_${SUFFIX}`,
    ]) {
      expect(parseApiKey(bad), bad).toBeNull();
    }
  });
});

describe("the browser guard (SDK-W3)", () => {
  it("refuses a secret key in a browser, with a named reason", () => {
    const restore = asBrowser();
    try {
      expect(detectRuntime().kind).toBe("browser");
      let thrown: unknown;
      try {
        checkCredential(SECRET_LIVE);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(ConfigurationError);
      expect((thrown as ConfigurationError).reason).toBe("secret_key_in_browser");
    } finally {
      restore();
    }
  });

  it("refuses before any network call — the error comes out of the constructor", () => {
    const restore = asBrowser();
    const fetchSpy = vi.fn();
    try {
      expect(() => new TrackCore({ apiKey: SECRET_LIVE, fetch: fetchSpy as never })).toThrow(
        ConfigurationError,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("tells the developer what to do, and never prints the key", () => {
    const restore = asBrowser();
    try {
      checkCredential(SECRET_LIVE);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("tc_pk_live_");
      expect(message).toContain("revoke");
      expect(message).toContain("TRACKCORE_RUNTIME=server");
      // The key itself is a credential (PF-K8, SDK-C7). Only the public label
      // and the last four characters appear.
      expect(message).not.toContain(SUFFIX);
      expect(message).toContain(`tc_sk_live_…${SUFFIX.slice(-4)}`);
    } finally {
      restore();
    }
  });

  it("allows a publishable key in a browser", () => {
    const restore = asBrowser();
    try {
      expect(() => checkCredential(PUBLISHABLE_LIVE)).not.toThrow();
    } finally {
      restore();
    }
  });

  it("allows a secret key on a server", () => {
    expect(detectRuntime().kind).toBe("server");
    expect(() => checkCredential(SECRET_LIVE)).not.toThrow();
  });

  it("there is no bypass flag", () => {
    // Deliberate. A `dangerouslyAllowBrowser` option's real function is to let
    // a developer silence the check at 6pm on a Friday; if a customer has a
    // genuine need, that is a product decision, not an option this SDK
    // pre-authorises.
    const restore = asBrowser();
    try {
      const options = { apiKey: SECRET_LIVE, dangerouslyAllowBrowser: true } as unknown as ConstructorParameters<
        typeof TrackCore
      >[0];
      expect(() => new TrackCore(options)).toThrow(ConfigurationError);
    } finally {
      restore();
    }
  });

  it("warns loudly, rather than throwing, in a runtime it cannot classify", () => {
    // Hide every signal detectRuntime() reads.
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("process", undefined);
    vi.stubGlobal("Deno", undefined);
    vi.stubGlobal("Bun", undefined);
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("EdgeRuntime", undefined);
    vi.stubGlobal("WorkerGlobalScope", undefined);
    vi.stubGlobal("importScripts", undefined);
    try {
      expect(detectRuntime().kind).toBe("unknown");
      const warn = vi.fn();
      expect(() => checkCredential(SECRET_LIVE, warn)).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain("tc_pk_live_");
      expect(warn.mock.calls[0]?.[0]).not.toContain(SUFFIX);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a worker with no document is treated as a browser", () => {
    vi.stubGlobal("WorkerGlobalScope", class {});
    vi.stubGlobal("process", undefined);
    try {
      expect(detectRuntime().kind).toBe("browser");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Cloudflare Workers, Deno and Bun are servers even with DOM-ish globals", () => {
    for (const [name, value] of [
      ["Deno", { version: { deno: "2.0.0" } }],
      ["Bun", { version: "1.1.0" }],
    ] as const) {
      vi.stubGlobal("window", { document: { defaultView: {} } });
      vi.stubGlobal(name, value);
      expect(detectRuntime().kind, name).toBe("server");
      vi.unstubAllGlobals();
    }
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(detectRuntime().kind).toBe("server");
    vi.unstubAllGlobals();
  });
});

describe("missing and malformed keys", () => {
  it("names the missing case", () => {
    for (const empty of [undefined, null, "", "   "]) {
      let thrown: unknown;
      try {
        checkCredential(empty);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as ConfigurationError).reason).toBe("api_key_missing");
    }
  });

  it("names the malformed case and does not echo the value", () => {
    const value = "sk_live_someones_actual_openai_key_pasted_by_mistake";
    let thrown: unknown;
    try {
      checkCredential(value);
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ConfigurationError).reason).toBe("api_key_malformed");
    expect((thrown as Error).message).not.toContain(value);
    expect((thrown as Error).message).toContain("not shown here because it is a credential");
  });
});

describe("the key never escapes the Credential (SDK-C7, PF-K8)", () => {
  it("is not a property, a key, a JSON field or an inspect output", () => {
    const credential = Credential.create(SECRET_LIVE);
    const surfaces = [
      JSON.stringify(credential),
      JSON.stringify({ ...credential }),
      String(credential),
      credential.describe(),
      Object.keys(credential).join(),
      Object.getOwnPropertyNames(credential).join(),
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      `${credential}`,
      (credential as unknown as Record<symbol, () => string>)[
        Symbol.for("nodejs.util.inspect.custom")
      ]?.() ?? "",
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(SUFFIX);
    }
    // It is reachable exactly once, where the transport needs it.
    expect(credential.authorizationHeader).toBe(`Bearer ${SECRET_LIVE}`);
  });

  it("the client does not expose it either", () => {
    const client = new TrackCore({ apiKey: SECRET_LIVE, fetch: (() => {}) as never });
    expect(JSON.stringify(client)).not.toContain(SUFFIX);
    expect(client.describeCredential()).toBe(`tc_sk_live_…${SUFFIX.slice(-4)}`);
    expect(client.environment).toBe("live");
    expect(client.keyKind).toBe("secret");
  });
});
