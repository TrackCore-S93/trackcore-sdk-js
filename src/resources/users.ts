import { decodeErasureReceipt } from "../decode.js";
import type { HasTransport } from "./foods";
import type { ErasureReceipt } from "../models";
import { assertValidExternalId } from "../identity.js";

/**
 * `DELETE /v1/users/{external_id}` — erase one end user and everything stored
 * for them (PF-T5).
 *
 * # This is a server-side call
 *
 * It requires a **secret key**, so it belongs in the customer's own backend,
 * in the code path that handles "delete my account". A device cannot call it,
 * by design: the most destructive thing the API can do to one person's data
 * must not be reachable with a credential that ships inside an app binary.
 *
 * # What it deletes
 *
 * Every row TrackCore holds for that end user — diary entries and their
 * snapshots, meals, days, goals, favourites, recents, custom foods and
 * recipes, owned snapshot blobs, health data, sessions — and the end user
 * record itself, in one transaction. The receipt says how many rows went from
 * each table; every table in the server's erasure registry appears, zero
 * included, so "nothing there" is distinguishable from an uncovered table.
 *
 * # Idempotent
 *
 * Calling it again for someone already erased returns the **original**
 * receipt with `replayed: true`. An id this account has never named and never
 * erased is a `404 user_not_found` (`ResourceError`), the one place that code
 * is used.
 *
 * # Not a diary delete
 *
 * `diary.deleteEntry` and friends are "I did not eat that". This is the GDPR
 * erasure. The id is sent in the path, not as `X-External-Id`, so the call
 * does not depend on `setUser` and does not provision the user it is about to
 * delete.
 */
export interface EraseUserOptions {
  readonly signal?: AbortSignal | undefined;
}

export async function eraseUser(
  client: HasTransport,
  externalId: string,
  options?: EraseUserOptions,
): Promise<ErasureReceipt> {
  // The same rule as setUser: trimmed, 1-255 code points, printable ASCII.
  // Checked here so a padded id is refused before a request is made rather
  // than answered 400 by the server, and so " u1" can never be sent in a path
  // where it would name a different end user than the unpadded id does.
  assertValidExternalId(externalId);
  const response = await client.transport.request({
    method: "DELETE",
    path: `/v1/users/${encodeURIComponent(externalId)}`,
    signal: options?.signal,
  });
  return decodeErasureReceipt(response.body);
}
