/**
 * `POST /v1/image/food` and `POST /v1/image/fridge`.
 *
 * The caller supplies the photo bytes. This module does not open a camera
 * and does not read a file. A capture or a file picker lives in the app, or
 * in the optional Flutter package, and hands the bytes here.
 *
 * Both calls send the photo to FatSecret image recognition. The entitlement
 * is what differs: `ai.food_scan` for a meal, `ai.fridge` for a fridge.
 */

import type { TrackCore } from "../client.js";
import { ProtocolError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { ExtractLabelOptions, LabelImage } from "./label.js";

export interface RecognizeImageOptions extends ExtractLabelOptions {
  /** Two-letter region. FatSecret defaults to US when omitted. */
  readonly region?: string | undefined;
  /** Used only when `region` is also set. */
  readonly language?: string | undefined;
}

/** Sends a meal photo and returns FatSecret's recognition. */
export function recognizeFood(
  client: TrackCore,
  image: LabelImage,
  options: RecognizeImageOptions = {},
): Promise<JsonObject> {
  return recognize(client, "food", image, options);
}

/** Sends a fridge photo and returns FatSecret's recognition. */
export function recognizeFridge(
  client: TrackCore,
  image: LabelImage,
  options: RecognizeImageOptions = {},
): Promise<JsonObject> {
  return recognize(client, "fridge", image, options);
}

async function recognize(
  client: TrackCore,
  kind: "food" | "fridge",
  image: LabelImage,
  options: RecognizeImageOptions,
): Promise<JsonObject> {
  const form = new FormData();
  const blob = image instanceof Blob ? image : imageBlob(image.bytes, options.contentType ?? image.contentType ?? "image/jpeg");
  form.append("image", blob, photoFilename(image, options, `${kind}.jpg`));

  const response = await client.transport.request({
    method: "POST",
    path: imagePath(kind, options),
    rawBody: form,
    timeoutMs: options.timeoutMs ?? 20_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeRecognition(response.body, response.status, response.requestId);
}

function imagePath(kind: "food" | "fridge", options: RecognizeImageOptions): string {
  const params = new URLSearchParams();
  if (options.region !== undefined && options.region !== "") params.set("region", options.region);
  if (options.language !== undefined && options.language !== "") params.set("language", options.language);
  const query = params.toString();
  return query === "" ? `/v1/image/${kind}` : `/v1/image/${kind}?${query}`;
}

function decodeRecognition(body: JsonValue, status: number, requestId: string | null): JsonObject {
  if (!isObject(body) || typeof body["status"] !== "string" || typeof body["result_kind"] !== "string" || !Array.isArray(body["items"])) {
    throw new ProtocolError("TrackCore's image response did not contain foods.", { status, requestId });
  }
  return body;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function imageBlob(bytes: Uint8Array, type: string): Blob {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type });
}

function photoFilename(image: LabelImage, options: RecognizeImageOptions, fallback: string): string {
  if (options.filename !== undefined) return safeFilename(options.filename, fallback);
  if (typeof File !== "undefined" && image instanceof File && image.name !== "") return safeFilename(image.name, fallback);
  if (!(image instanceof Blob) && image.filename !== undefined) return safeFilename(image.filename, fallback);
  return fallback;
}

function safeFilename(name: string, fallback: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim();
  return cleaned === "" ? fallback : cleaned;
}
