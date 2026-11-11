import { decodeHealthDaily, decodeHealthDeleteResult, decodeHealthRecords, decodeHealthUploadResult } from "../decode.js";
import type { HasTransport } from "./foods";
import type { HealthDaily, HealthDeleteResult, HealthPlatform, HealthRecords, HealthSource, HealthUploadResult } from "../models";
import { decimalOrNull } from "./profile.js";

/**
 * `/v1/health/records` and `/v1/health/daily` — weight, water, steps and the
 * other health values an end user logs or syncs.
 *
 * # Server calls, not a device capability
 *
 * This SDK reads no device health store. It sends values the app already has — a glass of water the user tapped, a weight they typed, or a
 * batch a device SDK read from the platform — to the API, which encrypts
 * every value before storing it (PF-T7).
 *
 * # Two gates on top of the end user
 *
 * The customer needs the `health.sync` entitlement **and** a Data Processing
 * Agreement on file, else `403 dpa_required` (`AuthorizationError`). The DPA
 * is recorded by TrackCore operations for the customer; it is not a request
 * parameter.
 *
 * # A manual entry is a batch of one
 *
 * `log([{ type: "water", value: 250, startAt: now }])` with the default
 * `platform: "app"`. The unit defaults to the type's canonical one (`ml`,
 * `kg`, `count`, `bpm`), and another unit is refused rather than converted.
 */
export interface HealthRecordInput {
  /** A catalogue code: `water`, `body_mass`, `steps`, `heart_rate`, … */
  readonly type: string;
  /** A string keeps the scale; a number is fine for a whole value. */
  readonly value: string | number;
  /** The type's canonical unit. Omitted means that unit. */
  readonly unit?: string | undefined;
  /** RFC 3339. */
  readonly startAt: string;
  readonly endAt?: string | null | undefined;
  /** IANA zone deciding the record's local day. Omitted means the batch's. */
  readonly timezone?: string | undefined;
  /** The platform's record id. Omitted derives one from the measurement. */
  readonly recordId?: string | undefined;
  readonly source?: HealthSource | undefined;
  readonly recordedAt?: string | undefined;
}

export interface LogHealthParams {
  readonly records: readonly HealthRecordInput[];
  /** `app` (the default), `healthkit` or `health_connect`. */
  readonly platform?: HealthPlatform | undefined;
  /** IANA zone for records that carry none. */
  readonly timezone?: string | undefined;
  /** Batch replay protection: the same key returns the original counts. */
  readonly idempotencyKey?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface HealthRecordsParams {
  /** Type codes. Omitted means every enabled type. */
  readonly types?: readonly string[] | undefined;
  /** RFC 3339, inclusive. Omitted means 30 days ago. */
  readonly from?: string | undefined;
  /** RFC 3339, exclusive. Omitted means now. */
  readonly to?: string | undefined;
  /** 1..500, default 100. */
  readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface DeleteHealthParams {
  readonly types: readonly string[];
  readonly from: string;
  readonly to: string;
  readonly signal?: AbortSignal | undefined;
}

export interface HealthDailyParams {
  readonly types?: readonly string[] | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  readonly from: string;
  /** `YYYY-MM-DD`, inclusive, at most 366 days after `from`. */
  readonly to: string;
  readonly signal?: AbortSignal | undefined;
}

export async function logHealthRecords(client: HasTransport, params: LogHealthParams): Promise<HealthUploadResult> {
  const records = params.records.map((record) => {
    const out: Record<string, unknown> = {
      type: record.type,
      value: decimalOrNull(record.value),
      start_at: record.startAt,
    };
    if (record.unit !== undefined) out["unit"] = record.unit;
    if (record.endAt !== undefined) out["end_at"] = record.endAt;
    if (record.timezone !== undefined) out["timezone"] = record.timezone;
    if (record.recordId !== undefined) out["record_id"] = record.recordId;
    if (record.source !== undefined) out["source"] = record.source;
    if (record.recordedAt !== undefined) out["recorded_at"] = record.recordedAt;
    return out;
  });
  const body: Record<string, unknown> = { platform: params.platform ?? "app", records };
  if (params.timezone !== undefined) body["timezone"] = params.timezone;
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/health/records",
    body,
    headers: params.idempotencyKey === undefined ? undefined : { "Idempotency-Key": params.idempotencyKey },
    signal: params.signal,
  });
  return decodeHealthUploadResult(response.body);
}

export async function listHealthRecords(client: HasTransport, params: HealthRecordsParams = {}): Promise<HealthRecords> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/health/records",
    query: { types: params.types?.join(","), from: params.from, to: params.to, limit: params.limit },
    signal: params.signal,
  });
  return decodeHealthRecords(response.body);
}

export async function deleteHealthRecords(client: HasTransport, params: DeleteHealthParams): Promise<HealthDeleteResult> {
  const response = await client.transport.request({
    method: "DELETE",
    path: "/v1/health/records",
    query: { types: params.types.join(","), from: params.from, to: params.to },
    signal: params.signal,
  });
  return decodeHealthDeleteResult(response.body);
}

export async function getHealthDaily(client: HasTransport, params: HealthDailyParams): Promise<HealthDaily> {
  const response = await client.transport.request({
    method: "GET",
    path: "/v1/health/daily",
    query: { types: params.types?.join(","), from: params.from, to: params.to },
    signal: params.signal,
  });
  return decodeHealthDaily(response.body);
}
