/**
 * TrackCore Web / JavaScript SDK — the public surface.
 *
 * **Server capabilities only** (D-015). There is no health sync, no voice and
 * no camera in this SDK: not as a method that throws, not as a type, not as a
 * `TODO`. Those are device capabilities and live in the Flutter and React
 * Native SDKs. A developer should learn the gap from autocomplete and the docs,
 * never from a runtime error (SDK-W1, D-004).
 *
 * `test/no-native-surface.test.ts` enforces that by grepping the built surface.
 */

export { TrackCore, DEFAULT_BASE_URL, VERSION, type TrackCoreOptions } from "./client.js";

// -- end-user identity (D-012) ----------------------------------------------
// `setUser` / `clearUser` are methods on the client; these are the pieces a
// consumer needs to validate an id themselves — at a form boundary, say —
// before it reaches the SDK.
export {
  EXTERNAL_ID_HEADER,
  EXTERNAL_ID_MAX_CODE_POINTS,
  assertValidExternalId,
} from "./identity.js";
export type { ExtractLabelOptions, LabelImage } from "./resources/label.js";
export type { RecognizeImageOptions } from "./resources/image.js";
export type { SearchSpeechOptions } from "./resources/nlp.js";

// -- the numeric contract ---------------------------------------------------
export { Decimal, isDecimal } from "./decimal.js";

// -- errors (SDK-C3) --------------------------------------------------------
export {
  TrackCoreError,
  TrackCoreAPIError,
  TrackCoreClientError,
  RequestError,
  AuthenticationError,
  AuthorizationError,
  ResourceError,
  RateLimitError,
  ServerError,
  DependencyError,
  MaintenanceError,
  ConfigurationError,
  ConnectionError,
  TimeoutError,
  AbortError,
  ProtocolError,
  ValidationError,
  isTrackCoreError,
  isAPIError,
  isErrorOfCode,
  type APIErrorInit,
  type ConfigurationErrorReason,
  type ErrorFields,
} from "./errors.js";

export {
  ALL_ERROR_CODES,
  ERROR_CODES,
  errorCodeSpec,
  isErrorCode,
  type ErrorCodeSpec,
  type RetryAfterPolicy,
  type TrackCoreErrorCategory,
  type TrackCoreErrorCode,
  type TrackCoreErrorField,
} from "./codes.js";

// -- tree-shakeable resource functions (SDK-W5) -----------------------------
export {
  searchFoods,
  getFood,
  batchFoods,
  lookupBarcode,
  BATCH_MAX_IDS,
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
  type BatchFoodsOptions,
  type GetFoodOptions,
  type HasTransport,
  type LookupBarcodeOptions,
  type SearchFoodsParams,
} from "./resources/foods.js";

// -- models (PLACEHOLDERS — T-107 regenerates these from the OpenAPI spec) ---
export type {
  BarcodeFormat,
  BarcodeLookup,
  BarcodeStatus,
  BatchReadResult,
  Capability,
  CapabilityCatalogue,
  CarbohydrateBasis,
  DataQuality,
  EnergyReconciliation,
  Food,
  FoodId,
  FoodType,
  NutrientUnit,
  NutrientValue,
  NutritionDocument,
  ProbeOk,
  Provenance,
  ProvenanceSource,
  ReconciliationBasis,
  ReconciliationReason,
  SearchResults,
  Serving,
  ServingId,
  Timestamp,
} from "./models.js";

// -- transport, retry and caching -------------------------------------------
export { MemoryResponseCache, type CacheEntry, type ResponseCache } from "./cache.js";
export {
  DEFAULT_RETRY_POLICY,
  backoffDelay,
  decideRetry,
  parseRetryAfter,
  type AttemptOutcome,
  type RetryContext,
  type RetryDecision,
  type RetryPolicy,
} from "./retry.js";
export { Transport, type Diagnostic, type FetchLike, type RequestOptions, type SuccessfulResponse, type TransportOptions } from "./transport.js";

// -- credentials and runtime detection --------------------------------------
export { Credential, parseApiKey, checkCredential, type KeyEnvironment, type KeyKind, type ParsedApiKey } from "./credentials.js";
export { detectRuntime, type RuntimeInfo, type RuntimeKind } from "./environment.js";

// -- the lexeme-preserving parser, for anyone wrapping the API themselves ----
export { parseJson, parseStrict, hasNativeSourceAccess, JsonParseError, type JsonObject, type JsonValue } from "./json.js";

// ---------------------------------------------------------------------------
// Diary, custom foods and sessions
// ---------------------------------------------------------------------------
export { SESSION_HEADER } from "./identity.js";
export type {
  DayParams,
  RangeParams,
  LogFoodParams,
  EditPortionParams,
  CreateMealParams,
  EditMealParams,
  CopyParams,
} from "./resources/diary.js";
export type {
  CustomServing,
  CreateCustomFoodParams,
  RecipeIngredient,
  CreateRecipeParams,
} from "./resources/ownfoods.js";
export type { CreateSessionParams } from "./resources/auth.js";
export type {
  DailyNutrition,
  DiaryMealEntry,
  MealFlags,
  DiaryMeal,
  DiaryMeals,
  DiaryRangeDay,
  DiaryRange,
  LoggedFood,
  Card,
  CardList,
  DeletionReceipt,
  ReorderResult,
  CopyResult,
  SessionToken,
} from "./models.js";
