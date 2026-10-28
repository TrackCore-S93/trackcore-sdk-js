/**
 * Runtime detection, for one purpose: deciding whether this code is running
 * somewhere a secret key would be extractable.
 *
 * # Why this file is not a nicety
 *
 * Both of the customer's existing apps shipped an extractable key. That is the
 * specific failure TrackCore's two-key model exists to fix, and a JavaScript
 * SDK is the single most likely place to reintroduce it, because the same
 * `import { TrackCore }` line compiles for a Node server and for a React
 * bundle. Nothing about the call site tells the developer which one they are
 * in — their framework decides, often at build time, often in a file they did
 * not write. So the SDK has to decide, at runtime, and say no.
 *
 * # What is actually detectable, and what is not
 *
 * There is no reliable "am I in a browser" API. What there are, are signals,
 * and this module reads them in order of how much they prove:
 *
 *   1. A named non-browser runtime announcing itself — `Deno`, `Bun`,
 *      Cloudflare Workers' `navigator.userAgent`, Node's `process.versions.node`
 *      *without* the DOM. These are positive proof of a server.
 *   2. A document — `window.document` with a `defaultView`. Positive proof of a
 *      page, which is positive proof the bundle is downloadable.
 *   3. A worker global without a document. Ambiguous: it is either a Web Worker
 *      inside a page (extractable) or an edge runtime (not). Treated as a
 *      browser, because the cost of being wrong in that direction is "an
 *      edge-runtime user has to tell us" and the cost of being wrong the other
 *      way is a leaked production secret.
 *   4. Nothing recognisable. Reported as `"unknown"`, which warns rather than
 *      throws — refusing to run in an environment we simply failed to classify
 *      would break legitimate runtimes that do not exist yet.
 *
 * A build can also pin the answer with `TRACKCORE_RUNTIME`, which is read from
 * `process.env` only — never from a `NEXT_PUBLIC_`/`VITE_` style variable,
 * because those are inlined into client bundles and a value that ships to the
 * browser is exactly the wrong thing to trust about whether we are in one.
 */

/** How much the SDK trusts the environment with a secret. */
export type RuntimeKind =
  /** Node, Deno, Bun, Cloudflare Workers, Vercel/Netlify edge. A secret is safe here. */
  | "server"
  /** A page, or a worker that could be inside one. A secret is extractable. */
  | "browser"
  /** Nothing identifiable. Treated as a server, loudly. */
  | "unknown";

export interface RuntimeInfo {
  readonly kind: RuntimeKind;
  /** The specific runtime, when it says: `"node"`, `"deno"`, `"bun"`, … */
  readonly name: string;
  /** Which signal decided it — quoted in the error, so the answer is debuggable. */
  readonly evidence: string;
}

function globalValue(name: string): unknown {
  return (globalThis as unknown as Record<string, unknown>)[name];
}

/**
 * Classify the current runtime. Called on construction and again before each
 * request, because a bundler can swap globals between the two and because an
 * SDK instance can outlive the moment it was created.
 */
export function detectRuntime(): RuntimeInfo {
  // (0) An explicit override, from a real process environment only.
  const forced = processEnv("TRACKCORE_RUNTIME");
  if (forced === "server" || forced === "browser") {
    return { kind: forced, name: forced, evidence: "TRACKCORE_RUNTIME" };
  }

  // (1) Runtimes that announce themselves. Checked before the DOM test,
  //     because Deno and Bun can both expose DOM-ish globals under flags.
  const deno = globalValue("Deno") as { version?: unknown } | undefined;
  if (deno && typeof deno === "object" && "version" in deno) {
    return { kind: "server", name: "deno", evidence: "globalThis.Deno.version" };
  }
  const bun = globalValue("Bun") as { version?: unknown } | undefined;
  if (bun && typeof bun === "object" && "version" in bun) {
    return { kind: "server", name: "bun", evidence: "globalThis.Bun.version" };
  }
  const navigatorRef = globalValue("navigator") as { userAgent?: unknown } | undefined;
  if (navigatorRef && navigatorRef.userAgent === "Cloudflare-Workers") {
    return { kind: "server", name: "cloudflare-workers", evidence: "navigator.userAgent" };
  }
  if (globalValue("EdgeRuntime") !== undefined) {
    return { kind: "server", name: "edge-runtime", evidence: "globalThis.EdgeRuntime" };
  }

  // (2) A document. The bundle that is running is one a user downloaded.
  const windowRef = globalValue("window") as { document?: { defaultView?: unknown } } | undefined;
  if (windowRef && typeof windowRef === "object" && windowRef.document?.defaultView !== undefined) {
    return { kind: "browser", name: "browser", evidence: "window.document.defaultView" };
  }
  if (globalValue("document") !== undefined && globalValue("location") !== undefined) {
    return { kind: "browser", name: "browser", evidence: "globalThis.document" };
  }

  // (3) Node — but only once the DOM tests above have failed, so that jsdom and
  //     a Vitest `environment: "jsdom"` run are classified as browsers, which
  //     is what a developer testing their front end would expect.
  const processRef = globalValue("process") as { versions?: { node?: unknown } } | undefined;
  if (processRef && typeof processRef.versions?.node === "string") {
    return { kind: "server", name: "node", evidence: "process.versions.node" };
  }

  // (4) A worker with no document and no server runtime behind it. Could be a
  //     Web Worker in a page. Assume the dangerous answer.
  if (globalValue("WorkerGlobalScope") !== undefined || globalValue("importScripts") !== undefined) {
    return { kind: "browser", name: "worker", evidence: "WorkerGlobalScope" };
  }

  return { kind: "unknown", name: "unknown", evidence: "no recognisable runtime global" };
}

/**
 * Reads a variable from a genuine process environment.
 *
 * Guarded because `process` is absent in a browser and *shimmed* by several
 * bundlers, which replace `process.env.FOO` with a string literal at build
 * time — a shim with no `versions.node` is not a Node process and its values
 * were baked into whatever shipped.
 */
export function processEnv(name: string): string | undefined {
  try {
    const processRef = globalValue("process") as
      | { env?: Record<string, string | undefined>; versions?: { node?: unknown } }
      | undefined;
    if (!processRef || typeof processRef.versions?.node !== "string") return undefined;
    const value = processRef.env?.[name];
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}
