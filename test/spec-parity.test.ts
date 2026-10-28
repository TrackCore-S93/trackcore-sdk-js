/**
 * Parity with `contracts/openapi.yaml`.
 *
 * T-107 owns the real generation-and-parity gate (SDK-C8). This is the
 * lightweight version that keeps the **hand-written placeholder types** in
 * `src/models.ts` honest until it lands, and it earns its place by having
 * already found six disagreements between what I inferred from the Go handlers
 * and what the spec publishes.
 *
 * It reads three things out of the spec and nothing else, so it needs no YAML
 * parser and no dependency:
 *
 *   - each schema's `properties` key set and `required` list
 *   - which schemas carry `x-trackcore-decimal: true`
 *   - the `x-trackcore-error-catalogue` code list
 *
 * The spec lives outside this package. If it is absent — a shallow checkout, a
 * published tarball — every test here skips rather than fails: a parity gate
 * that breaks the build when the thing it compares against is missing teaches
 * people to delete it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SPEC_PATH = join(import.meta.dirname, "..", "..", "..", "contracts", "openapi.yaml");
const available = existsSync(SPEC_PATH);
const spec = available ? readFileSync(SPEC_PATH, "utf8").split("\n") : [];

/** The lines of one `components/schemas` entry, excluding its own name line. */
function schemaBlock(name: string): string[] {
  const start = spec.findIndex((line) => line === `    ${name}:`);
  if (start < 0) throw new Error(`schema ${name} is not in the spec`);
  const out: string[] = [];
  for (const line of spec.slice(start + 1)) {
    // The next sibling schema, at the same indent, ends this one.
    if (/^ {4}[A-Za-z0-9_]+:/.test(line)) break;
    out.push(line);
  }
  return out;
}

/** The property names declared directly under a schema's `properties:`. */
function properties(name: string): string[] {
  const block = schemaBlock(name);
  const start = block.findIndex((line) => line === "      properties:");
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of block.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("        ")) break;
    const match = /^ {8}([A-Za-z0-9_]+):/.exec(line);
    if (match?.[1] !== undefined) out.push(match[1]);
  }
  return out.sort();
}

/** A schema's `required` list, in either the block or the flow form. */
function required(name: string): string[] {
  const block = schemaBlock(name);
  const start = block.findIndex((line) => line.startsWith("      required:"));
  if (start < 0) return [];
  const head = block[start] ?? "";
  const inline = /required:\s*\[(.*)\]/.exec(head);
  if (inline?.[1] !== undefined) {
    return inline[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "")
      .sort();
  }
  const out: string[] = [];
  for (const line of block.slice(start + 1)) {
    const match = /^ {8}- (.+)$/.exec(line);
    if (match?.[1] === undefined) break;
    out.push(match[1].trim());
  }
  return out.sort();
}

/**
 * The key set each placeholder interface declares.
 *
 * Written out rather than reflected, because a TypeScript interface has no
 * runtime representation to reflect. Keeping it here means the list is checked
 * against the spec on every run, so it cannot quietly drift from either side.
 */
const DECLARED: Record<string, { all: string[]; optional: string[] }> = {
  Food: {
    all: [
      "food_id",
      "food_type",
      "name",
      "brand",
      "servings",
      "default_serving_id",
      "data_quality",
      "ingredients",
      "directions",
      "recipe_servings",
      "energy_reconciliation",
      "tolerance_version",
      "provenance",
      "updated_at",
      "etag",
    ],
    optional: [],
  },
  Serving: {
    all: [
      "serving_id",
      "serving_id_version",
      "description",
      "household_unit",
      "base_quantity",
      "metric_amount",
      "metric_unit",
      "gram_weight_per_household_unit",
      "is_metric_default",
      "is_synthesised",
      "nutrition",
    ],
    optional: [],
  },
  EnergyReconciliation: {
    all: [
      "provider_value",
      "computed_value",
      "variance_pct",
      "flagged",
      "tolerance_version",
      "reason",
      "energy_source",
      "basis",
      "basis_serving_id",
    ],
    optional: ["energy_source", "basis_serving_id"],
  },
  Provenance: {
    all: ["source", "upstream_id", "upstream_version", "snapshot_at", "confidence", "fields"],
    optional: ["confidence"],
  },
  SearchResults: {
    all: [
      "query",
      "search_type",
      "page",
      "page_size",
      "page_size_clamped",
      "total_results",
      "has_more",
      "results",
    ],
    optional: [],
  },
  BatchReadResult: { all: ["found", "missing"], optional: [] },
  Capability: {
    all: [
      "code",
      "name",
      "description",
      "availability",
      "selectable",
      "billable",
      "requires_entitlement",
      "billed_as",
      "requires_dpa",
      "cost_class",
    ],
    optional: [],
  },
  CapabilityCatalogue: { all: ["environment", "capabilities"], optional: [] },
  ProbeOk: { all: ["status", "version"], optional: [] },
};

describe.skipIf(!available)("src/models.ts agrees with contracts/openapi.yaml", () => {
  for (const [name, declared] of Object.entries(DECLARED)) {
    it(`${name} declares exactly the spec's properties`, () => {
      expect(properties(name)).toEqual([...declared.all].sort());
    });

    it(`${name} marks exactly the spec's optional properties`, () => {
      // The spec's `required` plus the interface's optional keys must account
      // for every property, with no overlap: a key the spec requires and the
      // interface marks `?` is a field a customer will needlessly null-check,
      // and the reverse is a field they will read without checking at all.
      const specRequired = required(name);
      const specOptional = declared.all.filter((key) => !specRequired.includes(key)).sort();
      expect([...declared.optional].sort()).toEqual(specOptional);
    });
  }
});

describe.skipIf(!available)("the decimal contract", () => {
  it("the spec flags Decimal and DecimalOrNull, and only those", () => {
    const flagged = spec
      // Anchored at the schema-property indent, so the sentence in
      // `info.description` that *mentions* the extension is not counted as one.
      .map((line, index) => (line === "      x-trackcore-decimal: true" ? index : -1))
      .filter((index) => index >= 0)
      // The flag sits two lines below its schema's name line.
      .map((index) => spec.slice(Math.max(0, index - 4), index).reverse().find((l) => /^ {4}[A-Za-z0-9_]+:/.test(l)))
      .map((line) => line?.trim().replace(":", ""));
    expect([...new Set(flagged)].sort()).toEqual(["Decimal", "DecimalOrNull"]);
  });

  it("every field the spec types Decimal is a Decimal in src/models.ts", () => {
    // The spec's own list, read out of the schemas rather than retyped.
    const decimalFields: Record<string, string[]> = {};
    for (const schema of ["Serving", "Food", "EnergyReconciliation", "Provenance"]) {
      const block = schemaBlock(schema);
      let current: string | null = null;
      for (const line of block) {
        const property = /^ {8}([A-Za-z0-9_]+):/.exec(line);
        if (property?.[1] !== undefined) current = property[1];
        if (/Decimal(OrNull)?'?$/.test(line.trim()) && current !== null) {
          (decimalFields[schema] ??= []).push(current);
        }
      }
    }

    expect(decimalFields["Serving"]?.sort()).toEqual([
      "base_quantity",
      "gram_weight_per_household_unit",
      "metric_amount",
    ]);
    expect(decimalFields["Food"]).toEqual(["recipe_servings"]);
    expect(decimalFields["EnergyReconciliation"]?.sort()).toEqual([
      "computed_value",
      "provider_value",
      "variance_pct",
    ]);
    expect(decimalFields["Provenance"]).toEqual(["confidence"]);

    // `src/decode.ts` converts a field to `number` only if it is in
    // INTEGER_FIELDS. None of the above may ever be on that list.
    const decode = readFileSync(join(import.meta.dirname, "..", "src", "decode.ts"), "utf8");
    const integerList = /const INTEGER_FIELDS[\s\S]*?\]\);/.exec(decode)?.[0] ?? "";
    for (const fields of Object.values(decimalFields)) {
      for (const field of fields) {
        expect(integerList, `${field} must not be coerced to a number`).not.toContain(`"${field}"`);
      }
    }
  });

  it("the spec's own parity values round-trip", async () => {
    // contracts/README.md: "T-107's parity gate should test it with a value
    // that a double cannot hold (138.000, 0.1, 9007199254740993)."
    const { Decimal } = await import("../src/decimal.js");
    const { parseJson } = await import("../src/json.js");

    const body = '{"a":138.000,"b":0.1,"c":9007199254740993}';
    const parsed = parseJson(body) as Record<string, InstanceType<typeof Decimal>>;

    expect(parsed["a"]?.toString()).toBe("138.000");
    expect(parsed["b"]?.toString()).toBe("0.1");
    expect(parsed["c"]?.toString()).toBe("9007199254740993");

    // All three are values a double cannot hold, each in a different way.
    expect(String(JSON.parse(body).a)).toBe("138"); // scale gone
    expect(0.1 + 0.2).not.toBe(0.3); // not exact
    expect(JSON.parse(body).c).toBe(9007199254740992); // off by one, silently
    expect(parsed["c"]?.equals(new Decimal("9007199254740992"))).toBe(false);
  });

  it("provenance.upstream_id stays a string — the one documented exception", () => {
    const block = schemaBlock("Provenance").join("\n");
    expect(block).toMatch(/upstream_id:[\s\S]*?type: string/);
    const detail = readFileSync(join(import.meta.dirname, "fixtures", "food_detail.json"), "utf8");
    // A leading zero on a GTIN is significant; as a number it would be lost.
    expect(detail).toContain('"upstream_id":"35718"');
  });
});

describe.skipIf(!available)("the error enumeration", () => {
  it("the spec publishes the same 37 codes as src/codes.ts", async () => {
    const start = spec.findIndex((line) => line === "x-trackcore-error-catalogue:");
    const codesAt = spec.findIndex((line, index) => index > start && line === "  codes:");
    const codes: string[] = [];
    for (const line of spec.slice(codesAt + 1)) {
      if (line !== "" && !line.startsWith("    ")) break;
      const match = /^ {4}([a-z_]+):\s*$/.exec(line);
      if (match?.[1] !== undefined) codes.push(match[1]);
    }
    const { ALL_ERROR_CODES } = await import("../src/codes.js");
    expect(codes).toHaveLength(37);
    expect([...codes].sort()).toEqual([...ALL_ERROR_CODES].sort());
  });

  it("mirrors the two documented gaps rather than working around them", async () => {
    const { ERROR_CODES, isErrorCode } = await import("../src/codes.js");

    // Gap 1: there is no 405 and no method_not_allowed code. A method mismatch
    // answers 404 resource_not_found. The SDK must not invent either.
    expect(isErrorCode("method_not_allowed")).toBe(false);
    expect(Object.values(ERROR_CODES).some((row) => row.status === 405)).toBe(false);
    expect(ERROR_CODES.resource_not_found.status).toBe(404);

    // Gap 2: key_revoked is in the enumeration and is emitted by nothing; the
    // gateway sends credential_revoked for both. It stays in the type — a
    // client must still be able to name it — and the SDK branches on neither,
    // so there is nowhere for the duplication to cause a bug.
    expect(isErrorCode("key_revoked")).toBe(true);
    expect(ERROR_CODES.key_revoked.status).toBe(401);
    expect(ERROR_CODES.credential_revoked.status).toBe(401);
    const src = readFileSync(join(import.meta.dirname, "..", "src", "errors.ts"), "utf8");
    expect(src).not.toContain('"key_revoked"');
  });
});

describe.skipIf(!available)("the captured fixtures are what the spec describes", () => {
  it("a Food body carries exactly the spec's required keys and no others", () => {
    const food = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures", "food_detail.json"), "utf8"),
    ) as Record<string, unknown>;
    // `additionalProperties: false` everywhere, so this is an equality, not a
    // subset: a key the service sends and the spec does not document would be
    // just as much a drift as the reverse.
    expect(Object.keys(food).sort()).toEqual(properties("Food"));
    expect(Object.keys(food).sort()).toEqual(required("Food"));

    const serving = (food["servings"] as Record<string, unknown>[])[0];
    expect(Object.keys(serving ?? {}).sort()).toEqual(properties("Serving"));

    // Provenance omits `confidence` on a deterministic read: absent, not null.
    const provenance = food["provenance"] as Record<string, unknown>;
    expect(Object.keys(provenance).sort()).toEqual(required("Provenance"));
    expect("confidence" in provenance).toBe(false);

    // EnergyReconciliation carries both optional keys on this food.
    const reconciliation = food["energy_reconciliation"] as Record<string, unknown>;
    expect(Object.keys(reconciliation).sort()).toEqual(properties("EnergyReconciliation"));
  });

  it("a SearchResults body matches, and carries no paging_stability", () => {
    const page = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures", "search_apple.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(page).sort()).toEqual(properties("SearchResults"));
    // The service computes `pinned`/`best_effort`, logs it, and deliberately
    // does not put it on the wire pending a Product ruling. The SDK must not
    // model a field that is not sent.
    expect("paging_stability" in page).toBe(false);
  });

  it("a BatchReadResult body matches", () => {
    const batch = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures", "batch_found_missing.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(batch).sort()).toEqual(properties("BatchReadResult"));
  });

  it("an error body carries the five base fields plus only documented extras", () => {
    for (const [file, extras] of [
      ["err_food_gone.json", []],
      ["err_query_too_short.json", ["limit"]],
      ["err_upstream_unavailable.json", ["upstream"]],
      ["err_rate_limited.json", []],
      ["err_capability_maintenance.json", ["capability"]],
    ] as const) {
      const body = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", file), "utf8")) as {
        error: Record<string, unknown>;
      };
      expect(Object.keys(body).sort(), file).toEqual(["error"]);
      expect(Object.keys(body.error).sort(), file).toEqual(
        [...required("ErrorBody"), ...extras].sort(),
      );
    }
  });
});
