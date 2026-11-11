/**
 * Two source-level guards. Both protect invariants that are invisible at
 * runtime until they have already caused damage.
 *
 *   SDK-W1   no health, voice or camera API exists in this SDK, not even in the
 *            type definitions. A method that does not exist teaches the gap
 *            through autocomplete; a method that exists and throws teaches it
 *            in production (D-004, D-015).
 *
 *   DM-N1    no response is ever parsed with `JSON.parse`. One careless line
 *            would reintroduce the exact precision loss this SDK exists to
 *            prevent, and it would do so silently — nothing fails, the numbers
 *            are just quietly wrong.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string = SRC, into: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, into);
    else if (entry.endsWith(".ts")) into.push(path);
  }
  return into;
}

const files = sourceFiles();

describe("SDK-W1: no device capability exists in this SDK", () => {
  /**
   * Identifier-shaped matches only, so the prose in a comment explaining *why*
   * health sync is absent does not trip the guard that keeps it absent.
   */
  const forbidden: [string, RegExp][] = [
    ["health sync", /\b(healthKit|HealthKit|healthConnect|HealthConnect|healthSync|readHealth|writeHealth)\b/],
    ["voice", /\b(speechToText|startListening|SpeechRecognition|recordAudio|microphone)\b/],
    ["camera", /\b(scanBarcodeWithCamera|startScanner|visionCamera|CameraPermission|getUserMedia)\b/],
  ];

  for (const [capability, pattern] of forbidden) {
    it(`has no ${capability} symbol anywhere in src/`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders, `${capability} symbols found`).toEqual([]);
    });
  }

  it("the public barrel exports no device capability", async () => {
    const api = (await import("../src/index.js")) as Record<string, unknown>;
    const names = Object.keys(api);
    expect(names).toContain("lookupBarcode");
    const joined = names.join(" ").toLowerCase();
    for (const word of ["healthkit", "healthconnect", "healthsync", "voice", "camera", "scanner", "microphone"]) {
      // The health ROUTES are server capabilities and are exported
      // (`logHealthRecords` sends values the app already holds); the device
      // SYNC that reads the platform's health store is not, and must not be.
      expect(joined, word).not.toContain(word);
    }
    // Server-side lookup is the one barcode export. A camera or a scanner
    // must not appear beside it, including under a name that also says barcode.
    for (const name of names) {
      expect(name).not.toMatch(/scan|camera|vision|microphone/i);
    }
  });
});

describe("DM-N1: no response is parsed with JSON.parse", () => {
  it("JSON.parse appears only inside the parser, and only on the native path", () => {
    const callers = files.filter((file) => /\bJSON\.parse\s*\(/.test(readFileSync(file, "utf8")));
    // `src/json.ts` uses it with the ES2025 reviver, which *does* give the raw
    // lexeme. Anywhere else it would be the silent precision loss.
    expect(callers.map((f) => f.replace(SRC, ""))).toEqual(["/json.ts"]);
  });

  it("every JSON.parse in the parser passes a reviver", () => {
    const source = readFileSync(join(SRC, "json.ts"), "utf8");
    for (const call of source.match(/JSON\.parse\([^)]*\)/g) ?? []) {
      expect(call, call).toMatch(/,/);
    }
  });

  it("the transport decodes through parseJson", () => {
    const source = readFileSync(join(SRC, "transport.ts"), "utf8");
    expect(source).toContain("parseJson(text)");
    expect(source).not.toMatch(/\bresponse\.json\(\)/);
  });
});

describe("SDK-W2: nothing Node-only is on the request path", () => {
  it("src/ imports no node: module", () => {
    const offenders = files.filter((file) => /from\s+["']node:/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });

  it("src/ requires nothing", () => {
    const offenders = files.filter((file) => /\brequire\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([]);
  });
});

describe("SDK-W4: zero runtime dependencies", () => {
  it("package.json declares none", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });

  it("src/ imports nothing but itself", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/^\.{1,2}\//);
      }
    }
  });
});

describe("D-012: the end-user header has exactly one writer", () => {
  /**
   * The whole point of putting `X-External-Id` in the transport is that no
   * resource has to remember it. A second place that spells the header is a
   * place that can forget it, send it empty, or send a different user's — and
   * none of those three fails loudly. They fail as attribution that is simply
   * missing or wrong, weeks later, in somebody's billing.
   */
  it("the header name is written once, in identity.ts", () => {
    const named = files.filter((file) => /["']X-External-Id["']/.test(readFileSync(file, "utf8")));
    expect(named.map((f) => f.replace(SRC, ""))).toEqual(["/identity.ts"]);
  });

  it("only the transport puts it on a request", () => {
    const setters = files.filter((file) =>
      /headers\[\s*EXTERNAL_ID_HEADER\s*\]\s*=/.test(readFileSync(file, "utf8")),
    );
    expect(setters.map((f) => f.replace(SRC, ""))).toEqual(["/transport.ts"]);
  });

  it("the barrel exports the identity surface", async () => {
    const api = (await import("../src/index.js")) as Record<string, unknown>;
    for (const name of ["EXTERNAL_ID_HEADER", "EXTERNAL_ID_MAX_CODE_POINTS", "assertValidExternalId"]) {
      expect(Object.keys(api), name).toContain(name);
    }
  });

  it("length is measured in code points, never in UTF-16 units", () => {
    // `value.length` on an id would reject 255 astral-plane code points that
    // Go's `utf8.RuneCountInString` accepts. The spread is the whole fix, and
    // it is one character away from being undone by a tidy-up.
    const source = readFileSync(join(SRC, "identity.ts"), "utf8");
    expect(source).toContain("[...value]");
    expect(source).not.toMatch(/\bvalue\.length\b/);
  });
});

describe("no offline machinery (decided 2026-10-23)", () => {
  it("there is no queue, no replay and no client-side scaling", () => {
    const forbidden = /\b(offlineQueue|enqueueWrite|replayQueue|scaleServing|scaleNutrition|multiplyNutrients)\b/;
    const offenders = files.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("SDK-C2: Decimal offers no arithmetic for a client to scale with", async () => {
    const { Decimal } = await import("../src/decimal.js");
    const methods = Object.getOwnPropertyNames(Decimal.prototype);
    for (const banned of ["add", "sub", "subtract", "mul", "multiply", "div", "divide", "round", "times"]) {
      expect(methods, banned).not.toContain(banned);
    }
  });
});
