import { decodeSessionToken } from "../decode.js";
import type { HasTransport } from "./foods";
import type { SessionToken } from "../models";

/**
 * `POST /v1/auth/session` — mint an end-user session token.
 *
 * # This is a server-side call, and the SDK cannot stop you misusing it
 *
 * It requires a **secret key**, so it belongs in the customer's own backend. A
 * device cannot call it, by design: if a device could mint its own session
 * token it would be able to mint one for any end user, which is the hole the
 * token exists to close.
 *
 * The flow is:
 *
 *   1. your backend authenticates your user however it already does
 *   2. your backend calls this with its secret key and that user's id
 *   3. your backend hands the token to the device
 *   4. the device's TrackCore client carries a publishable key plus the token
 *      (`setSession`), and can then read and write only that user's diary
 *
 * A token for user A used against user B is `403 user_scope_violation`, and an
 * expired or revoked one is `401 session_expired`, which the device SDK treats
 * as "ask the backend for a fresh one".
 *
 * **The token is opaque.** It is not a JWT and carries nothing you can decode —
 * the response states the end user and the expiry explicitly instead. That is a
 * deliberate departure from an earlier design note and is still subject to
 * change.
 */
export interface CreateSessionParams {
  readonly externalId: string;
  /** Seconds. Defaults to one hour; at most 24 hours. */
  readonly ttlSeconds?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export async function createSession(
  client: HasTransport,
  params: CreateSessionParams,
): Promise<SessionToken> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/auth/session",
    body: { external_id: params.externalId, ttl_seconds: params.ttlSeconds },
    signal: params.signal,
  });
  return decodeSessionToken(response.body);
}
