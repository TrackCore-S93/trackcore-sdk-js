/**
 * API credentials: parsing, classification, and the browser guard (SDK-W3).
 *
 * The format is the gateway's, from `services/gateway/internal/keys/tokens.go`:
 *
 *     tc_sk_live_7kQ2…   secret, server only, shown once at creation (PF-K1)
 *     tc_pk_live_9mF4…   publishable, safe in a client bundle
 *     tc_sk_test_… / tc_pk_test_…   the same two, test environment (PF-K5)
 *
 * The prefix is not decoration. Migration 0003 enforces it as a CHECK
 * constraint, and the gateway rejects an unparseable credential as
 * `401 credential_malformed` without touching the database — which it can only
 * do because kind and environment are readable from the string itself. The same
 * property is what lets this SDK refuse a secret key *before* sending it, which
 * is the only moment at which refusing is still useful.
 *
 * # Why the secret-key-in-browser check throws rather than warns
 *
 * A warning is a line in a console nobody reads during a CI build. The failure
 * it is warning about is a production secret in a JavaScript bundle on a CDN,
 * which is not recoverable by rotating a key quietly — it is an incident. Both
 * of this customer's existing apps shipped an extractable key, so this is a
 * demonstrated failure mode rather than a theoretical one. SDK-W3 says
 * "rejected in a browser context with a named error", and that is what happens:
 * a `ConfigurationError` with `reason: "secret_key_in_browser"`, raised from the
 * constructor, before any network call.
 *
 * **There is deliberately no escape hatch.** Other SDKs ship a
 * `dangerouslyAllowBrowser` flag; this one does not, because the flag's real
 * function is to let a developer silence the check at 6pm on a Friday. If a
 * customer has a genuine need, that is a product decision for the PM, not an
 * option this file should pre-authorise.
 */

import { ConfigurationError } from "./errors.js";
import { detectRuntime, type RuntimeInfo } from "./environment.js";

/** Which of the two key kinds this is. `sk` or `pk` in the prefix. */
export type KeyKind = "secret" | "publishable";

/** PF-K5: the same code path, marked in responses, metered apart, never billed. */
export type KeyEnvironment = "live" | "test";

export interface ParsedApiKey {
  readonly kind: KeyKind;
  readonly environment: KeyEnvironment;
  /** `tc_sk_live` — the label, without the random part. Safe to log. */
  readonly prefix: string;
  /** The last four characters, which is what a dashboard shows. Safe to log. */
  readonly last4: string;
}

/**
 * Mirrors `keys.tokenPattern` exactly, including the 40–86 character range:
 * `KEY_ENTROPY_BYTES` is configurable server-side and a key issued under one
 * setting has to keep parsing after the setting changes.
 */
const TOKEN_PATTERN = /^tc_(sk|pk)_(live|test)_([0-9A-Za-z]{40,86})$/;

/** Parses a credential, or returns `null`. Never throws, never logs the value. */
export function parseApiKey(key: string): ParsedApiKey | null {
  const match = TOKEN_PATTERN.exec(key);
  if (!match) return null;
  const [, slug, environment, suffix] = match;
  if (slug === undefined || environment === undefined || suffix === undefined) return null;
  return Object.freeze({
    kind: slug === "sk" ? ("secret" as const) : ("publishable" as const),
    environment: environment as KeyEnvironment,
    prefix: `tc_${slug}_${environment}`,
    last4: suffix.slice(-4),
  });
}

export interface CredentialCheck {
  readonly parsed: ParsedApiKey;
  readonly runtime: RuntimeInfo;
}

/** Where a diagnostic goes when the SDK wants to say something out loud. */
export type Warn = (message: string) => void;

const defaultWarn: Warn = (message) => {
  // eslint-disable-next-line no-console
  console.warn(message);
};

/**
 * Validates a credential for the runtime it is about to be used in.
 *
 * Throws `ConfigurationError` for:
 *   - a missing or empty key (`api_key_missing`)
 *   - a key that is not a TrackCore credential (`api_key_malformed`)
 *   - a **secret** key in a detected browser (`secret_key_in_browser`) — SDK-W3
 *
 * Warns, and continues, for a secret key in an environment that could not be
 * classified at all. Refusing there would break runtimes that do not exist yet;
 * staying silent would be the failure this whole module is about.
 */
export function checkCredential(key: unknown, warn: Warn = defaultWarn): CredentialCheck {
  if (typeof key !== "string" || key.trim() === "") {
    throw new ConfigurationError(
      "api_key_missing",
      "No TrackCore API key was supplied. Pass `apiKey` to the client, or set TRACKCORE_API_KEY " +
        "in a server environment.",
    );
  }

  const parsed = parseApiKey(key.trim());
  if (!parsed) {
    // The rejected value is a credential. Its shape is described; the value
    // itself never appears here or in any log line (PF-K8, SDK-C7).
    throw new ConfigurationError(
      "api_key_malformed",
      "The TrackCore API key is not in a recognised format. A key looks like " +
        "`tc_sk_live_…` (secret, server only) or `tc_pk_live_…` (publishable). " +
        "The value supplied is not shown here because it is a credential.",
    );
  }

  const runtime = detectRuntime();

  if (parsed.kind === "secret" && runtime.kind === "browser") {
    throw new ConfigurationError(
      "secret_key_in_browser",
      `A TrackCore secret key (${parsed.prefix}_…${parsed.last4}) was used in a browser. ` +
        `Anything in a browser bundle is readable by anyone who loads the page, so this key ` +
        `must be treated as compromised: revoke it and issue a new one. ` +
        `Use a publishable key (tc_pk_${parsed.environment}_…) in client code, and keep the ` +
        `secret key on your server. ` +
        `(Runtime detected as "${runtime.name}" from ${runtime.evidence}. If that is wrong — ` +
        `for example a server runtime this SDK does not yet know — set TRACKCORE_RUNTIME=server ` +
        `in your server environment.)`,
    );
  }

  if (parsed.kind === "secret" && runtime.kind === "unknown") {
    warn(
      `[trackcore] A secret key is in use in a runtime this SDK could not identify ` +
        `(${runtime.evidence}). If this code can reach a browser, the key is extractable: ` +
        `use a publishable key (tc_pk_${parsed.environment}_…) instead. ` +
        `Set TRACKCORE_RUNTIME=server to silence this.`,
    );
  }

  return { parsed, runtime };
}

/**
 * Holds a credential without exposing it.
 *
 * The raw key lives in a closure. There is no property to read it from, so it
 * cannot reach a log through `JSON.stringify(client)`, a `{ ...client }`
 * spread, `util.inspect`, or an error reporter walking the object graph
 * (SDK-C7, PF-K8). The only thing that gets the value is
 * {@link Credential.authorizationHeader}, which the transport calls.
 */
export class Credential {
  readonly kind: KeyKind;
  readonly environment: KeyEnvironment;
  readonly prefix: string;
  readonly last4: string;

  readonly #header: string;

  private constructor(key: string, parsed: ParsedApiKey) {
    this.kind = parsed.kind;
    this.environment = parsed.environment;
    this.prefix = parsed.prefix;
    this.last4 = parsed.last4;
    // Pre-rendered so the bare key is never held as a field at all.
    this.#header = `Bearer ${key}`;
    Object.freeze(this);
  }

  /** Parses, classifies and environment-checks in one step. */
  static create(key: unknown, warn?: Warn): Credential {
    const { parsed } = checkCredential(key, warn);
    return new Credential((key as string).trim(), parsed);
  }

  /** The `Authorization` header value. The only route out for the secret. */
  get authorizationHeader(): string {
    return this.#header;
  }

  /** `tc_sk_live_…abcd`. Safe in a log; this is what a dashboard shows. */
  describe(): string {
    return `${this.prefix}_…${this.last4}`;
  }

  toString(): string {
    return `Credential(${this.describe()})`;
  }

  toJSON(): string {
    return this.describe();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}
