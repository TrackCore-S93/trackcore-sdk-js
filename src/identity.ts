/**
 * End-user identity: the `X-External-Id` header and the rules a value has to
 * satisfy before it is allowed anywhere near a socket.
 *
 * # The dual-ID model, in one paragraph
 *
 * TrackCore never asks a customer to adopt TrackCore's idea of a user (D-012).
 * The customer's app sends **its own** identifier — a Firebase UID, a row id,
 * whatever it already has — in `X-External-Id`, and the gateway upserts an
 * `app_user` row keyed `unique (customer_id, external_id)` the first time it
 * sees one (`provisionUser` in
 * `services/gateway/internal/httpx/guard.go`, T-047). The internal UUID is
 * never spoken aloud; the API only ever answers in the customer's own id
 * (T-056). So "identify the user" on this side is nothing more than deciding
 * which string rides along on every request, which is why
 * {@link TrackCore.setUser} is synchronous and makes no network call.
 *
 * # Why the rules below are stricter than the gateway's
 *
 * `validExternalID` on the server accepts any string that equals its own
 * trimmed form and is 1–255 **runes** long. This module enforces exactly that,
 * and then one rule more: every code point must be printable ASCII,
 * `0x20`–`0x7E`.
 *
 * That extra rule is not fussiness, it is the only honest option available to a
 * JavaScript client. An HTTP header value is bytes, and `fetch` has no say in
 * which encoding a JS string becomes:
 *
 *   - a code point above `0xFF` cannot be put in a header at all — `fetch`
 *     throws a bare `TypeError` from somewhere deep in the platform, at request
 *     time, with nothing in the message tying it back to `setUser`;
 *   - a code point in `0x80`–`0xFF` is worse, because it *succeeds*. It goes
 *     out as a single Latin-1 byte, Go reads the header as the bytes it
 *     received, and `"café"` arrives as the four bytes `caf\xE9` rather than
 *     the five bytes of UTF-8 the caller meant. That is a valid-looking,
 *     different id, so it provisions a **second** `app_user` row and silently
 *     splits one person's history in two. Nothing fails. Nothing logs.
 *
 * Refusing loudly at the call site beats corrupting quietly at 3am. The durable
 * fix is percent-encoding the header with a matching decode in the gateway;
 * that is a cross-stack change and deliberately out of scope here.
 *
 * In practice the rule costs nothing: Firebase UIDs, UUIDs, integer ids, ULIDs
 * and ordinary email addresses are all printable ASCII. A customer whose ids
 * genuinely are not should hear about it on the first call in development, not
 * from a support ticket about a user who "lost their diary".
 *
 * # Why no message here ever contains the id
 *
 * An `external_id` is the customer's own user identifier and is quite often an
 * email address. `src/errors.ts` keeps unrecognised response bodies out of
 * error messages for exactly this reason — a message travels straight into a
 * log aggregator, an error tracker, and sometimes the customer's own API
 * response. The same discipline applies in this direction. A rejection says
 * what rule was broken, and at most names the offending code point as
 * `U+XXXX` with its position, which is what a developer actually needs to fix
 * it.
 */

import { ConfigurationError } from "./errors.js";

/**
 * The header the gateway reads. An **absent** header means "provision nobody"
 * and is the normal state before sign-in — and so does a present-but-blank
 * one. `provisionUser` (`services/gateway/internal/httpx/guard.go`) reads the
 * value with Go's `Header.Get`, which answers `""` both for a header that is
 * not there and for one that is there with an empty value — `net/textproto`
 * having already stripped the optional whitespace, so `X-External-Id:` and
 * `X-External-Id:   ` are `""` too — and returns early on `""` either way.
 * Absent and blank are therefore **indistinguishable** at the gateway and both
 * provision nobody (BUG-028). There is no `400` in that case; a genuinely
 * non-empty but padded value such as `"a "` is the one that is a `400`, via
 * `validExternalID`.
 *
 * The transport nonetheless omits the header entirely rather than ever sending
 * an empty one, because that leaves "no user" exactly **one** spelling on the
 * wire. One spelling is what a proxy log, a packet capture and a reader of the
 * request can all agree on, and it is what keeps this SDK correct if the blank
 * case is ever tightened into the `400` it is sometimes assumed to be.
 */
export const EXTERNAL_ID_HEADER = "X-External-Id";

/** The server's ceiling, counted in Unicode code points, not UTF-16 units. */
export const EXTERNAL_ID_MAX_CODE_POINTS = 255;

/**
 * Throws unless `value` is an id this SDK is willing to send.
 *
 * Synchronous and total: it either returns having proved the value safe, or
 * throws {@link ConfigurationError} with a `reason` naming the broken rule.
 * Nothing is trimmed, lower-cased or otherwise repaired on the caller's behalf
 * — an id the SDK quietly rewrote is an id that reads back as somebody else.
 */
export function assertValidExternalId(value: string): void {
  // TypeScript says this is a string; a plain-JavaScript caller, a `JSON.parse`
  // result or an `any` from a framework says nothing of the sort. Checking
  // first turns `undefined.trim is not a function` into a named error that says
  // which argument was wrong.
  if (typeof value !== "string") {
    throw new ConfigurationError(
      "external_id_not_a_string",
      `\`setUser\` takes a string. It was given ${describeType(value)}. Pass your own ` +
        `identifier for the signed-in user — a Firebase UID, a database id — or call ` +
        `\`clearUser()\` to stop sending one.`,
    );
  }

  // Padding is rejected rather than trimmed, matching `validExternalID`. If the
  // SDK trimmed, `" u1"` and `"u1"` would be the same user here and two
  // different users in any customer that ever reaches the API without this SDK.
  if (value !== value.trim()) {
    throw new ConfigurationError(
      "external_id_untrimmed",
      "`setUser` was given an id with leading or trailing whitespace. TrackCore rejects " +
        "it rather than trimming it, because trimming would make two different ids collide. " +
        "Trim it where it is read, so the value the SDK sends is the value you stored.",
    );
  }

  // Code points, not UTF-16 code units. `"𝄞".length` is 2 and `[..."𝄞"].length`
  // is 1; Go counts runes, so `.length` would refuse ids the server accepts.
  const codePoints = [...value];

  if (codePoints.length === 0) {
    throw new ConfigurationError(
      "external_id_empty",
      "`setUser` was given an empty string. There is no such user. To sign a user out, " +
        `call \`clearUser()\`, which stops sending \`${EXTERNAL_ID_HEADER}\` at all. An empty ` +
        "header would not be an error — the gateway cannot tell one from a missing header, " +
        "and reads both as a request to provision nobody — which is exactly why this SDK " +
        "omits it: " +
        "a signed-out request then has one unambiguous shape on the wire.",
    );
  }

  if (codePoints.length > EXTERNAL_ID_MAX_CODE_POINTS) {
    throw new ConfigurationError(
      "external_id_too_long",
      `\`setUser\` was given an id of ${codePoints.length} characters. The limit is ` +
        `${EXTERNAL_ID_MAX_CODE_POINTS}, measured in Unicode code points, and it is the ` +
        `column's limit rather than a client-side opinion.`,
    );
  }

  for (let index = 0; index < codePoints.length; index++) {
    // `codePointAt(0)` on a single-code-point string is always defined; the
    // array came from the spread, so every element is exactly one code point.
    const code = codePoints[index]!.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e) {
      throw new ConfigurationError(
        "external_id_not_ascii",
        `\`setUser\` was given an id containing ${formatCodePoint(code)} at position ` +
          `${index}. TrackCore's JavaScript SDK accepts printable ASCII only (U+0020 to ` +
          `U+007E) in \`${EXTERNAL_ID_HEADER}\`: an HTTP header cannot carry this string ` +
          `unchanged, so sending it would either fail inside \`fetch\` or arrive at the ` +
          `server as a different id and provision a second user. Map the id to ASCII — a ` +
          `hash, a UUID or a base64 form — before passing it.`,
      );
    }
  }
}

/** `U+00E9`. Names the code point without reproducing the id around it. */
function formatCodePoint(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** A type name for an error message. Never the value: it could be the id. */
function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return type === "undefined" ? "undefined" : `a ${type}`;
}

/**
 * The header a device carries its end-user session token in.
 *
 * A separate header from `Authorization`, because a device presents **two**
 * credentials: a publishable key saying which customer, and a session token
 * saying which end user. Putting both in `Authorization` would mean parsing a
 * compound credential, and the gateway already treats two credentials as two
 * rather than preferring one of them: a secret key *and* a session token is
 * `400 ambiguous_credentials`.
 */
export const SESSION_HEADER = "X-TrackCore-Session";
