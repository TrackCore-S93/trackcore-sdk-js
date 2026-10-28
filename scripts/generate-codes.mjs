#!/usr/bin/env node
/**
 * Regenerates `src/codes.ts` from `test/fixtures/contract_codes.json`.
 *
 * The fixture itself is a dump of the Go catalogue — `contract.All()` in
 * `libs/contract` — so this script is a transcription step, not a source of
 * truth. To refresh the fixture, run the Go dump in `libs/contract` and copy
 * the result here; never hand-edit either file.
 *
 * T-107 replaces this with generation from the OpenAPI spec in `contracts/`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const rows = JSON.parse(readFileSync(join(root, "test/fixtures/contract_codes.json"), "utf8"));
rows.sort((a, b) => a.status - b.status || a.code.localeCompare(b.code));

const union = (values) => values.map((v) => `  | ${JSON.stringify(v)}`).join("\n") + ";";
const categories = [...new Set(rows.map((r) => r.category))].sort();
const fields = [...new Set(rows.flatMap((r) => r.allowed_fields))].sort();

const out = `/**
 * The closed error-code enumeration (PF-X2), mirrored from \`libs/contract\`.
 *
 * **This file is generated.** It is a transcription of the Go catalogue in
 * \`libs/contract/codes.go\`, produced by dumping \`contract.All()\` from the Go
 * package itself rather than by reading the source and typing it out. The dump
 * is checked in at \`test/fixtures/contract_codes.json\`, and
 * \`test/codes.test.ts\` re-derives this table from it, so a code added or
 * changed on the server fails a test here with the name of what moved.
 *
 * "Closed" is load-bearing: \`libs/contract\` makes a code outside the
 * enumeration literally unspellable in Go, and \`TrackCoreErrorCode\` below is
 * the same promise in TypeScript — a \`switch\` over it is exhaustive, and the
 * compiler will tell a customer when a new code appears in a later SDK version.
 *
 * Regenerate with \`npm run codegen:codes\` after re-dumping the Go catalogue.
 * T-107 replaces this file with output generated from the OpenAPI spec.
 */

/** What *kind* of failure a code is, independent of its HTTP status. */
export type TrackCoreErrorCategory =
${union(categories)}

/** Whether \`retry_after_seconds\` may, must or must not appear on a code. */
export type RetryAfterPolicy = "forbidden" | "optional" | "required";

/** Every error code the API can return. Thirty-seven, and no others. */
export type TrackCoreErrorCode =
${union(rows.map((r) => r.code))}

/** One row of the catalogue. */
export interface ErrorCodeSpec {
  readonly code: TrackCoreErrorCode;
  readonly status: number;
  readonly category: TrackCoreErrorCategory;
  readonly retryAfter: RetryAfterPolicy;
  readonly docsUrl: string;
}

/**
 * The catalogue, keyed by wire string.
 *
 * Used to classify a response into the right error subclass and to prove that a
 * \`code\` on the wire is one the SDK knows. A code that is *not* in here is a
 * protocol violation — the server promised a closed enumeration — and is
 * surfaced as a \`ProtocolError\` rather than guessed at.
 */
export const ERROR_CODES: Readonly<Record<TrackCoreErrorCode, ErrorCodeSpec>> = Object.freeze({
${rows
  .map(
    (r) => `  ${r.code}: Object.freeze({
    code: ${JSON.stringify(r.code)},
    status: ${r.status},
    category: ${JSON.stringify(r.category)},
    retryAfter: ${JSON.stringify(r.retry_after)},
    docsUrl: ${JSON.stringify(r.docs_url)},
  }),`,
  )
  .join("\n")}
});

/** The documented extra fields an envelope may carry beside the base five. */
export type TrackCoreErrorField =
${union(fields)}

/** Narrows an arbitrary string to a member of the enumeration. */
export function isErrorCode(value: unknown): value is TrackCoreErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, value);
}

/** The catalogue row for a code. */
export function errorCodeSpec(code: TrackCoreErrorCode): ErrorCodeSpec {
  return ERROR_CODES[code];
}

/** Every code, in status then alphabetical order — the order \`contract.All()\` uses. */
export const ALL_ERROR_CODES: readonly TrackCoreErrorCode[] = Object.freeze(
  Object.keys(ERROR_CODES) as TrackCoreErrorCode[],
);
`;

writeFileSync(join(root, "src/codes.ts"), out);
console.log(`src/codes.ts: ${rows.length} codes`);
