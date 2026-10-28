/**
 * The closed enumeration (PF-X2), checked against the Go catalogue.
 *
 * `test/fixtures/contract_codes.json` is a dump of `contract.All()` from
 * `libs/contract` — the package that makes a code outside the enumeration
 * literally unspellable in Go. If a code is added, removed, restatused or
 * recategorised there, these tests fail and name it.
 *
 * Re-dump the fixture and run `npm run codegen:codes` to adopt a change; never
 * hand-edit `src/codes.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_ERROR_CODES, ERROR_CODES, errorCodeSpec, isErrorCode } from "../src/codes.js";

interface GoRow {
  code: string;
  status: number;
  category: string;
  retry_after: string;
  docs_url: string;
}

const goCatalogue = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures/contract_codes.json"), "utf8"),
) as GoRow[];

describe("the enumeration matches libs/contract", () => {
  it("has exactly thirty-seven codes", () => {
    expect(goCatalogue).toHaveLength(37);
    expect(ALL_ERROR_CODES).toHaveLength(37);
  });

  it("names the same codes, in the same order", () => {
    const expected = [...goCatalogue]
      .sort((a, b) => a.status - b.status || a.code.localeCompare(b.code))
      .map((r) => r.code);
    expect([...ALL_ERROR_CODES]).toEqual(expected);
  });

  it("agrees on every row", () => {
    for (const row of goCatalogue) {
      expect(isErrorCode(row.code), row.code).toBe(true);
      const spec = errorCodeSpec(row.code as never);
      expect(spec.status, row.code).toBe(row.status);
      expect(spec.category, row.code).toBe(row.category);
      expect(spec.retryAfter, row.code).toBe(row.retry_after);
      expect(spec.docsUrl, row.code).toBe(row.docs_url);
    }
  });
});

describe("the rulings the enumeration encodes", () => {
  it("P-020: capability_maintenance is the only 503", () => {
    const fiveOhThrees = goCatalogue.filter((r) => r.status === 503);
    expect(fiveOhThrees.map((r) => r.code)).toEqual(["capability_maintenance"]);
    // `grounds` ships a kill switch keyed on 502/503, so the split is
    // load-bearing: 503 = we turned it off, 502 = it broke.
    expect(ERROR_CODES.capability_maintenance.category).toBe("maintenance");
    expect(ERROR_CODES.upstream_unavailable.status).toBe(502);
    expect(ERROR_CODES.upstream_unavailable.category).toBe("dependency");
  });

  it("PF-R2 / PF-X4: the two codes that must carry retry_after_seconds do", () => {
    expect(ERROR_CODES.rate_limited.retryAfter).toBe("required");
    expect(ERROR_CODES.capability_maintenance.retryAfter).toBe("required");
  });

  it("PF-K2 / P-033: 401 is four separate cases, not one", () => {
    const four = ["credential_missing", "credential_malformed", "credential_revoked", "credential_unknown"];
    for (const code of four) {
      expect(ERROR_CODES[code as never]).toBeDefined();
      expect(errorCodeSpec(code as never).status).toBe(401);
    }
  });

  it("the withdrawn code has not crept back", () => {
    // P-020 / PF-X4 deleted it: a capability that is down is an unplanned
    // dependency failure, so 502 upstream_unavailable with `upstream` naming it.
    expect(isErrorCode("capability_unavailable")).toBe(false);
  });

  it("food_gone is 410 and distinct from resource_not_found", () => {
    expect(ERROR_CODES.food_gone.status).toBe(410);
    expect(ERROR_CODES.resource_not_found.status).toBe(404);
  });

  it("rejects a code that is not in the enumeration", () => {
    expect(isErrorCode("not_a_real_code")).toBe(false);
    expect(isErrorCode("")).toBe(false);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });

  it("is frozen, so a customer cannot teach the SDK a code the API has not got", () => {
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(ERROR_CODES.food_gone)).toBe(true);
  });
});
