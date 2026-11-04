# TrackCore Web / JavaScript SDK

A thin, typed HTTP client for the TrackCore nutrition API (T-108, SDK-W1…SDK-W5,
D-015). TypeScript, strict mode, **zero runtime dependencies**, ESM and CJS,
Node 18.17+ and modern browsers.

**No voice, no camera, no health** — not in the code and not in the type
definitions. Those are device capabilities and live in the Flutter and React
Native SDKs. You should learn the gap from autocomplete and from this file,
never from a runtime error (SDK-W1, D-004, D-015).

```ts
import { TrackCore } from "@trackcore/sdk";

const trackcore = new TrackCore({ apiKey: process.env.TRACKCORE_API_KEY });

const page = await trackcore.foods.search({ q: "apple", pageSize: 20 });
const food = await trackcore.foods.get(page.results[0].food_id);

console.log(`${food.name}: ${food.servings[0].nutrition.energy?.value} kcal`);
```

A runnable version covering search → read → `missing[]` → typed errors is in
[`examples/quickstart.mjs`](examples/quickstart.mjs). It runs with no key and no
network, against the captured responses in `test/fixtures/`:

```sh
npm install && npm run build && npm run example
```

---

## The most important thing in this SDK: numbers are not `number`

Every nutrient value crosses the wire as a JSON **number**, deliberately.
Upstream sends `"calories": "72"` — a quoted numeral — and TrackCore's whole
reason for existing is to return `72`. The server goes to real trouble over
this: `services/nutrition/internal/dec` is a purpose-built exact-decimal type
whose `MarshalJSON` has no switch to flip, written because `shopspring/decimal`
defaults to emitting a quoted string.

**`JSON.parse` undoes all of it in one line.** It has exactly one numeric type,
IEEE-754 binary64. Over a real captured response:

| on the wire | after `JSON.parse` | what was lost |
|---|---|---|
| `138.000` | `138` | the provider's stated scale |
| `0.030` | `0.03` | the same |
| `28.350` | `28.35` | the same |
| `138.0000000000000000` | `138` | sixteen digits |
| `19.06` | `19.059999999999998721…` | exactness |
| `9007199254740993` | `9007199254740992` | the value, silently, by one |

The scale losses are information losses — a figure reported to three decimal
places is a different statement about the world from one reported to none. The
exactness losses are worse, because they compound. Binary64 addition is not
associative, so summing one real food's five servings forwards and backwards
gives two different answers:

```
80.709999999999993747   // forwards
80.710000000000007958   // backwards
```

A day of logging is a few dozen additions. Two clients that total the same
entries in different orders would disagree about a user's calorie total, and
neither could say which was wrong. That is exactly the drift the backend just
removed, reintroduced on the client where nobody is looking for it.

### What this SDK does instead

**Responses are parsed with a lexeme-preserving parser, and every number arrives
as a `Decimal` carrying the exact substring the server sent.** `JSON.parse` does
not appear on any response path; a test asserts that, because the failure mode
is silent.

```ts
const serving = food.servings[0];

serving.metric_amount.toString();  // "138.000"  — exact, as sent
serving.metric_amount.source;      // "138.000"  — the same, named plainly
serving.metric_amount.scale;       // 3
serving.metric_amount.toNumber();  // 138        — the lossy conversion, by name

serving.nutrition.saturated_fat?.value.toString();  // "0.039"
serving.nutrition.carbohydrate?.value.toString();   // "19.06"
```

### The trade-offs, stated

Three options were on the table. This is what each costs.

**1. A reviver over `JSON.parse`.** ES2025 added `context.source` to the
reviver, which does hand back the raw lexeme, and it is the fastest correct
option because the native parser does the scanning. But SDK-W2 fixes the floor
at Node 18, which has no `context.source`. "Exact on new runtimes, silently
lossy on old ones" is the worst possible shape for this particular function.
*Taken as an optimisation, not as the mechanism:* the SDK probes for it at load
and uses it where it exists, with the portable parser as the baseline. Both
paths are covered by the same tests and a test asserts they produce identical
trees over every captured fixture.

**2. A decimal library — `decimal.js` or `big.js`.** Correct, well-tested, and
it would give arithmetic. Rejected on two counts. SDK-W4 is "zero runtime
dependencies beyond `fetch`", and a nutrition SDK that drags a bignum library
into every customer's bundle is the kind of weight that gets an SDK rejected —
`grounds` already pins `http` back through `dependency_overrides`, which is the
behaviour this product is trying not to provoke. And it would not have solved
the actual problem on its own: `decimal.js` still needs the raw token, and
`JSON.parse` has already destroyed it before any library sees it.

**3. A hand-written parser producing a minimal `Decimal`.** Chosen. About 300
lines, no dependency, identical behaviour on every runtime, and it is the only
option that preserves the lexeme on Node 18.

**What it costs you, honestly:**

- **Parsing is slower than `JSON.parse`** on runtimes without `context.source`.
  Response bodies here are single-digit kilobytes and the SDK makes one network
  round trip per call, so this is not measurable next to the request itself —
  but it is a real cost and it is not nothing.
- **`Decimal` has no arithmetic.** No `add`, no `multiply`, no `round`. That is
  deliberate twice over: SDK-C2 forbids nutrition summation and portion scaling
  in any SDK (scaling is `POST /v1/foods/scale`, server-side), and shipping
  arithmetic would mean shipping a bignum implementation after all. If you
  genuinely need to compute outside what the API offers, hand `.toString()` to
  `decimal.js` or `big.js` — a lossless token is exactly what they want as
  input, and preserving it is what makes that handover possible.
- **You must say `.toNumber()` to get a `number`.** `valueOf()` exists, so
  `+d` and `Math.max(a, b)` work in plain JavaScript (without it, `d1 < d2`
  would silently become *string* comparison, where `"9" > "10"`). But
  TypeScript refuses relational and arithmetic operators on object types
  whatever their `valueOf`, so in TypeScript you will write `.toNumber()` or
  `.compare()`. That is the right place to end up; it just is not free.
- **Re-serialisation is exact only where `JSON.rawJSON` exists** (Node 21.3+,
  current browsers). `JSON.stringify(food)` always emits a bare JSON number and
  never a quoted numeral — DM-N1 holds either way — but on older runtimes the
  scale flattens. `Decimal.isExactlyReSerialisable()` tells you which you have.

### Comparing values

```ts
a.equals(b);     // exact: 138.000 equals 138
a.compare(b);    // -1 | 0 | 1, exact, never via a double
a.identical(b);  // lexeme identity: 138.000 is NOT identical to 138
a.isZero();      // an affirmative zero from the provider
```

`compare` is exact where `toNumber()` is not: `0.1` and `0.10000000000000001`
are the same double and are not the same value.

### Which fields are `Decimal`, and which are `number`

`Decimal` is every field the spec flags `x-trackcore-decimal: true` — every
nutrient value, every serving amount, every reconciliation figure. `number` is
reserved for the spec's `integer` fields: `page`, `page_size`, `total_results`,
`serving_id_version`, `retry_after_seconds`, `limit`. Counters and indices,
where a double is exact by construction.

One deliberate exception, which the spec also calls out:
`provenance.upstream_id` is a **string** even though it looks numeric. It is an
identifier, not a quantity, and a leading zero on a GTIN is significant.

### `null` is never `0`

```ts
serving.nutrition.vitamin_d;        // null  — modelled, provider gave nothing
serving.nutrition.cholesterol;      // { value: Decimal("0"), unit: "mg" }
serving.nutrition.not_a_nutrient;   // undefined — not modelled at all (DM-N8)
```

Three states, all distinct, all meaningful (DM-N2). Nothing in this SDK coerces
between them. Both applications this API replaces lost that distinction, and one
invented a boolean to cope with having lost it.

---

## Keys: `tc_sk_…` is a secret, `tc_pk_…` is not

| prefix | kind | where it may go |
|---|---|---|
| `tc_sk_live_…`, `tc_sk_test_…` | **secret** | your server, and nowhere else |
| `tc_pk_live_…`, `tc_pk_test_…` | publishable | safe in a browser bundle |

**A secret key in a browser throws before anything is sent.**

```
ConfigurationError: A TrackCore secret key (tc_sk_live_…kM3) was used in a
browser. Anything in a browser bundle is readable by anyone who loads the page,
so this key must be treated as compromised: revoke it and issue a new one.
Use a publishable key (tc_pk_live_…) in client code, and keep the secret key on
your server. (Runtime detected as "browser" from window.document.defaultView. …)
```

`error.reason === "secret_key_in_browser"`, so you can branch on it. It is
raised from the constructor, before any network call, which is the only moment
at which refusing is still useful.

**There is no bypass flag.** Other SDKs ship `dangerouslyAllowBrowser`; this one
does not, because the flag's real function is to let someone silence the check at
6pm on a Friday. If you have a genuine need, that is a conversation with
TrackCore, not an option this SDK pre-authorises.

The detection reads, in order: a runtime announcing itself (`Deno`, `Bun`,
Cloudflare Workers, Node without a DOM) → a `document` → a worker global with no
document, which is treated as a browser because it might be one. A runtime it
cannot classify **warns loudly and continues**, since refusing there would break
runtimes that do not exist yet. Pin it with `TRACKCORE_RUNTIME=server`, which is
read only from a real `process.env` — never from a `NEXT_PUBLIC_`/`VITE_`
variable, because those are inlined into client bundles and a value that ships
to the browser is the wrong thing to trust about whether you are in one.

The key itself is held in a closure. It is not a property, so it cannot reach a
log through `JSON.stringify(client)`, a spread, `util.inspect` or an error
reporter walking the object graph (SDK-C7, PF-K8). `client.describeCredential()`
gives you `tc_sk_live_…kM3`, which is what a dashboard shows.

---

## Identifying your end users

TrackCore never asks you to adopt TrackCore's idea of a user (D-012). You pass
**your own** identifier — a Firebase UID, a row id, a ULID — and the gateway
creates the matching record the first time it sees it, keyed to your account.
The API only ever speaks your id back to you.

```ts
trackcore.setUser(firebaseUser.uid);   // at sign-in
trackcore.clearUser();                 // at sign-out
trackcore.externalId;                  // the current id, or null
```

`setUser` is synchronous and makes no network call: it stores a string, and
every request the client makes from then on carries it as `X-External-Id` —
the food reads, the AI capture routes, the ETag revalidations and `health()`
alike. Before `setUser`, and after `clearUser`, the header is **not sent at
all** rather than sent empty. The gateway reads an absent `X-External-Id` and a
present-but-blank one identically — both mean "provision nobody" — so omitting
it is not about avoiding an error, it is about leaving a signed-out request one
unambiguous shape on the wire.

The id is checked on the spot and a bad one throws `ConfigurationError` before
anything is sent, with a `reason` naming the rule it broke:

| `reason` | what it means |
|---|---|
| `external_id_untrimmed` | leading or trailing whitespace. Rejected, not trimmed: trimming would make `" u1"` and `"u1"` the same user here and two users everywhere else |
| `external_id_empty` | the empty string. Use `clearUser()` to sign out |
| `external_id_too_long` | over 255 **Unicode code points** — the column's limit, counted the way the server counts it, not in UTF-16 units |
| `external_id_not_ascii` | a code point outside `U+0020`–`U+007E` |
| `external_id_not_a_string` | something that is not a string, which TypeScript already rules out |

That ASCII rule is one the server does not have, and it is deliberate. An HTTP
header is bytes, and JavaScript gives you no say in the encoding: a code point
above `U+00FF` makes `fetch` throw from somewhere deep in the platform, and —
worse — one in `U+0080`–`U+00FF` **succeeds**, going out as a single Latin-1
byte. `"café"` then arrives at the server as a different, valid-looking id,
provisioning a second user and quietly splitting one person's history in two.
Nothing fails; nothing logs. Refusing at the call site is the only honest
option until the header is percent-encoded end to end.

In practice it costs nothing: Firebase UIDs, UUIDs, ULIDs, integer ids and
email addresses are all printable ASCII. If yours are not, hash them or map
them to a UUID before passing them in. `assertValidExternalId` is exported if
you want to apply the same check earlier, at your own form boundary.

---

## Errors

Every non-2xx is a typed error carrying a `code` from the closed 37-member
enumeration (PF-X2), plus `request_id` and `docs_url` (SDK-C3).

```ts
import { isErrorOfCode, MaintenanceError, RateLimitError, isAPIError } from "@trackcore/sdk";

try {
  await trackcore.foods.get(id);
} catch (error) {
  if (isErrorOfCode(error, "food_gone")) {
    // 410: the provider no longer resolves this id. Drop it from your cache.
  } else if (error instanceof MaintenanceError) {
    // 503, and 503 means ONLY this: we turned a capability off on purpose.
    // Show a banner; retry after error.retryAfterSeconds.
  } else if (error instanceof RateLimitError) {
    // 429 or 402.
  } else if (isAPIError(error)) {
    console.error(error.code, error.requestId, error.docsUrl);
  }
}
```

| class | when |
|---|---|
| `RequestError` | 400 and the other request-shape rejections |
| `AuthenticationError` | 401 — missing, malformed, revoked, unknown, expired |
| `AuthorizationError` | 402 / 403 |
| `ResourceError` | 404 / 410 / 422 |
| `RateLimitError` | 429, and 402 `quota_exceeded` |
| `ServerError` | 500 — TrackCore's own defect |
| `DependencyError` | 502 — something TrackCore depends on **broke** |
| `MaintenanceError` | 503 — TrackCore turned it **off on purpose** |

The 502/503 split is load-bearing, not cosmetic: `grounds` ships a kill switch
keyed on both and has to keep seeing them as different things.

And, before you ever reach the server:

| class | when |
|---|---|
| `ConfigurationError` | a secret key in a browser, a bad key, a bad `baseUrl` |
| `ValidationError` | an argument that trips a published limit, e.g. >100 batch ids |
| `ConnectionError` | DNS, TLS, connection refused, offline |
| `TimeoutError` | a per-attempt timeout, or the overall deadline |
| `AbortError` | your own `AbortSignal` fired |
| `ProtocolError` | the reply was not a TrackCore envelope |

### Nothing from an unrecognised body reaches an error message

The backend guarantees no upstream message leaks: `libs/contract` has no
exported way to put free text into an envelope, so no provider body, SQL
fragment or internal URL can travel in one (PF-X1, PF-X3, PF-B7). This SDK does
not undo that by splicing a failed response into `new Error(...)`.

When the body is not a conforming envelope — a proxy's HTML, a captive portal,
a code outside the enumeration — you get a `ProtocolError` whose message is
fixed text. The body is on `error.bodySample`, **non-enumerable**: there when
you ask for it by name, and absent from `JSON.stringify(err)`, from `{ ...err }`
and from most structured loggers.

### Two gaps the API documents, which this SDK mirrors

1. **There is no `405`.** The enumeration is closed and has no slot for it, so a
   method mismatch answers `404 resource_not_found`. This SDK does not invent a
   `method_not_allowed`.
2. **`key_revoked` is emitted by nothing.** PF-K3 names it; P-033 settles
   credential rejection at four `401` cases and names `credential_revoked`. The
   gateway sends `credential_revoked` for both. The code stays in the type —
   you must still be able to name it — and this SDK branches on neither, so
   there is nowhere for the duplication to cause a bug. **Branch on
   `credential_revoked`.**

---

## Timeouts and retries

```ts
new TrackCore({
  apiKey,
  timeoutMs: 10_000,   // one attempt
  deadlineMs: 30_000,  // the whole call, retries and backoff included
  retry: { maxAttempts: 3, max502Attempts: 2 },
});
```

Two clocks, because either alone is wrong: a per-attempt timeout lets three
attempts plus two backoffs run far past what you expected, and a deadline alone
lets one hung socket eat all of it.

**Retried:** connection failure, attempt timeout, `408`, `429`, `503`, `504`.
`Retry-After` wins over the exponential schedule where the server sent one — and
the SDK falls back to the envelope's `retry_after_seconds` when a
header-normalising proxy has stripped it. Backoff is exponential with **full**
jitter, not `delay ± 10 %`: the point of jitter is to stop a thousand clients
that failed at the same instant from retrying at the same instant.

**Not retried:** every other 4xx, and `500` — TrackCore's own defect, which
repeating will not fix.

**`502` is capped at one retry.** This is the one genuinely interesting decision
in the policy. `upstream_unavailable` is P-020's catch-all: *every* unplanned
dependency failure becomes it, including an upstream rejecting a request
TrackCore forwarded. From outside, "the provider is down" and "this request can
never succeed" are **indistinguishable** — same code, same message, same
`upstream` field, by design, because PF-X3 forbids the provider's own message
from crossing over. So a blind retry loop on 502 sends a doomed request again
and again at full backoff, burns your rate-limit budget and TrackCore's provider
quota, and turns a 200 ms error into a 30 s hang. One retry covers a genuine
blip; the cap stops the storm. Set `max502Attempts: 1` to disable it entirely.

A non-idempotent request is retried **only** when an `Idempotency-Key` is set
(SDK-C4). This SDK issues only GETs today; the rule is implemented and tested
now because the diary writes that will need it are the ones where getting it
wrong means duplicate entries in someone's food log.

---

## Caching: ETag revalidation only

```ts
import { MemoryResponseCache } from "@trackcore/sdk";

const trackcore = new TrackCore({ apiKey, cache: new MemoryResponseCache(256) });
await trackcore.foods.get(id, { revalidate: true });
```

Off unless you pass a cache. When on, a read sends `If-None-Match` with the
stored validator and a `304` means your stored body is still correct.

**There is no offline mode, no queue and no client-side scaling.** Decided
2026-10-23: portion edits require the network and clients never do their own
nutrition arithmetic (SDK-C2, DM-N10). Every read still goes to the server; the
cache only makes it cheap. There is no TTL and no serve-while-revalidate.

The ETag is the staleness signal whose absence left `grounds`' Hive cache
**disabled in code** (DM-F5). It is derived from the food's own content and
deliberately excludes `updated_at` and `provenance.snapshot_at`, both of which
move on every read until the server-side cache lands (T-025) — so the validator
is stable for an unchanged food and a `304` actually fires.

The cache is bounded and its depth is readable (`cache.size`), because the
natural key is the request URL and a search-as-you-type UI makes one per
keystroke.

---

## API

```
new TrackCore({ apiKey, baseUrl?, timeoutMs?, deadlineMs?, retry?, cache?,
                fetch?, headers?, onDiagnostic?, warn? })

trackcore.setUser(externalId)                             // sends X-External-Id from now on
trackcore.clearUser()                                     // stops sending it
trackcore.externalId                                      // string | null, read-only

trackcore.foods.search({ q, page?, pageSize?, region?, language?, signal?, revalidate? })
trackcore.foods.get(foodId, { signal?, revalidate? })
trackcore.foods.batch(ids, { signal?, revalidate? })      // max 100 (P-021)
trackcore.capabilities.list({ signal? })
trackcore.health()
```

Each food method is also a standalone function taking the client first —
`searchFoods(trackcore, { q })` — which is the form that tree-shakes (SDK-W5).

### How much actually shakes out, measured

The ESM build is published **unbundled**, one file per module, because
`sideEffects: false` alone does not get you there: several classes here carry a
computed method key (`[Symbol.for("nodejs.util.inspect.custom")]`, which is what
makes a credential print as `tc_sk_live_…kM3` instead of leaking into a log),
and a bundler cannot prove a computed key is side-effect-free. Flattened into
one file, those class declarations are retained and drag everything they touch
with them.

esbuild, minified, importing from `dist/`:

| what you import | bundle |
|---|---|
| `searchFoods` alone | **0.7 KB** |
| `TrackCore` + `searchFoods` + `isErrorOfCode` | 27.6 KB |
| the entire SDK | 29.4 KB |

Read that honestly: **the standalone functions shake completely, the client
class does not.** `TrackCore` exposes `foods.search`, `foods.get` and
`foods.batch` as fields, so constructing one pulls in all three plus the
transport. What still drops is anything you have not touched — the ETag cache,
the capability catalogue, the resources you never named.

If you want the floor, use the standalone functions and skip the class. Making
the class form shake as well would mean resources opt-in at construction, which
is an API design change and is flagged for the team rather than taken here.

`apiKey` falls back to `TRACKCORE_API_KEY` and `baseUrl` to
`TRACKCORE_BASE_URL`, both from a real process environment only.

### Reading a result

`missing[]` is the part worth reading carefully:

```ts
const { found, missing } = await trackcore.foods.batch(ids);
for (const id of missing) {
  // Genuinely unresolvable — malformed, not a TrackCore id, another tenant's
  // custom food, or gone from the provider. NEVER a transient failure; that is
  // a 502 for the whole request. Which is what makes it safe to act on: drop
  // the favourite, prune the cache. An outage must never read as an absence.
}
```

Likewise, a search that matched nothing is a `200` with `results: []`, and an
outage is a `502`. The two are never confused (US-10).

---

## What this SDK will not do for you

- **Scale a portion.** `POST /v1/foods/scale`, server-side. The moment a client
  multiplies a nutrient by a quantity there are two implementations of the
  product's core promise and one of them is wrong.
- **Sum a day.** Same reason (SDK-C2).
- **Parse a numeric string.** The API does not send any (DM-N1).
- **Check which keys a food has.** Every key is present on every food (DM-F6).
  A client writing that check is writing the defensive parsing this API exists
  to delete.

---

## Status

**Pre-v1, and the API surface it wraps is partial.** `contracts/openapi.yaml`
covers the three food reads, `/v1/capabilities` and the probes; barcode, NLP,
AI capture, the diary and health are specified and not built. The nutrient set
is **not frozen** (OQ-8 / T-128) — every catalogue row is status `candidate`, so
expect nutrient keys to change before v1.

`src/models.ts` is a **placeholder**. T-107 regenerates it from the OpenAPI
spec with a CI parity gate (SDK-C8); `test/spec-parity.test.ts` holds the line
until then, checking every key set, every required/optional split and every
decimal field against `contracts/openapi.yaml` on each run.

`src/codes.ts` is **generated** from the Go catalogue in `libs/contract` — the
same package every service returns errors through. Regenerate with
`npm run codegen:codes`; never hand-edit it.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test            # vitest
npm run build       # tsup -> ESM + CJS + .d.ts
npm run example     # the quickstart, against captured responses
```

Tests run against **real captured responses**, not mocks. The bodies in
`test/fixtures/` were produced by driving the actual Go handlers over the seven
captured `food-api` responses in
`services/nutrition/internal/fixtures/testdata/`. The first version of the
server's own parser was written against a guessed envelope and could not read a
single live response while 230 tests passed, because the mocks encoded the same
guess — a mock can only confirm the shape you already believe in.
