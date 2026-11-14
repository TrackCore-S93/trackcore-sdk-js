import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ERROR_CODES, isErrorCode } from "../src/codes.js";
import { ALL_ERROR_DOMAINS, ALL_ERROR_REASONS, ERROR_REASONS, isErrorReason } from "../src/reasons.js";
import { errorFromEnvelope, isErrorOfReason } from "../src/errors.js";
import { parseStrict } from "../src/json.js";

/**
 * `test/fixtures/contract_reasons.json` is a dump of `contract.AllDomains()`
 * and `contract.AllReasons()` from the Go package. `src/reasons.ts` is
 * rendered from it, and this keeps the two in step.
 */
const goDump = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/contract_reasons.json"), "utf8")) as {
  domains: string[];
  reasons: { reason: string; code: string; status: number; domain: string; message_template: string }[];
};

describe("the reason catalogue matches libs/contract", () => {
  it("names the same domains", () => {
    expect([...ALL_ERROR_DOMAINS]).toEqual(goDump.domains);
  });
  it("names the same reasons, in the same order, each under a known code", () => {
    expect([...ALL_ERROR_REASONS]).toEqual(goDump.reasons.map((r) => r.reason));
    for (const row of goDump.reasons) {
      expect(isErrorReason(row.reason), row.reason).toBe(true);
      const spec = ERROR_REASONS[row.reason as keyof typeof ERROR_REASONS];
      expect(isErrorCode(spec.code), row.reason).toBe(true);
      expect(ALL_ERROR_CODES).toContain(spec.code);
      expect(spec.status, row.reason).toBe(row.status);
      expect(spec.domain, row.reason).toBe(row.domain);
      expect(spec.messageTemplate, row.reason).toBe(row.message_template);
    }
  });
});

describe("an envelope's domain and reason", () => {
  it("become typed properties, and stay out of fields", () => {
    const body = parseStrict(
      '{"error":{"code":"invalid_request","message":"Another meal already occupies that minute on that day.","request_id":"req_1","docs_url":"https://docs.trackcore.dev/errors/invalid_request","retry_after_seconds":null,"domain":"diary","parameter":"eaten_at","reason":"meal_minute_taken"}}',
    );
    const error = errorFromEnvelope(body, 400, null);
    expect(error?.domain).toBe("diary");
    expect(error?.reason).toBe("meal_minute_taken");
    expect(error?.fields).toEqual({ parameter: "eaten_at" });
    expect(isErrorOfReason(error, "meal_minute_taken")).toBe(true);
    expect(isErrorOfReason(error, "meal_not_found")).toBe(false);
    expect(String(error)).toContain("[diary/invalid_request#meal_minute_taken]");
  });
  it("are null when the envelope carries none", () => {
    const body = parseStrict(
      '{"error":{"code":"credential_missing","message":"x","request_id":null,"docs_url":"https://docs.trackcore.dev/errors/credential_missing","retry_after_seconds":null}}',
    );
    const error = errorFromEnvelope(body, 401, null);
    expect(error?.domain).toBeNull();
    expect(error?.reason).toBeNull();
  });
});
