/**
 * `POST /v1/label`.
 *
 * The caller supplies the photo bytes. This module does not open a camera
 * and does not read a file. A capture or a file picker lives in the app, or
 * in the optional Flutter package, and hands the bytes here.
 */

import type { TrackCore } from "../client.js";
import { ProtocolError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";

/** A photo already in memory, or a Blob from a picker. */
export type LabelImage = Blob | { readonly bytes: Uint8Array; readonly contentType?: string; readonly filename?: string };

export interface ExtractLabelOptions {
  readonly signal?: AbortSignal | undefined;
  /** Per-attempt budget. A scan is slower than a food read. Default 30s. */
  readonly timeoutMs?: number | undefined;
  readonly filename?: string | undefined;
  readonly contentType?: string | undefined;
}

/** Sends the photo and returns the scanner's extraction. */
export async function extractLabel(
  client: TrackCore,
  image: LabelImage,
  options: ExtractLabelOptions = {},
): Promise<JsonObject> {
  const form = new FormData();
  const blob = image instanceof Blob ? image : imageBlob(image.bytes, options.contentType ?? image.contentType ?? "image/jpeg");
  form.append("image", blob, photoFilename(image, options));

  const response = await client.transport.request({
    method: "POST",
    path: "/v1/label",
    rawBody: form,
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeLabelScan(response.body, response.status, response.requestId);
}

function decodeLabelScan(body: JsonValue, status: number, requestId: string | null): JsonObject {
  if (!isObject(body) || typeof body["status"] !== "string" || typeof body["is_product_label"] !== "boolean" || !("food" in body)) {
    throw new ProtocolError("TrackCore's label response did not contain a food.", { status, requestId });
  }
  return body;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function imageBlob(bytes: Uint8Array, type: string): Blob {
  // Copy the view into a fresh ArrayBuffer. A Uint8Array over a shared
  // buffer is not a BlobPart in the DOM types, and the copy is the photo.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type });
}

function photoFilename(image: LabelImage, options: ExtractLabelOptions): string {
  if (options.filename !== undefined) return safeFilename(options.filename);
  if (typeof File !== "undefined" && image instanceof File && image.name !== "") return safeFilename(image.name);
  if (!(image instanceof Blob) && image.filename !== undefined) return safeFilename(image.filename);
  return "label.jpg";
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim();
  return cleaned === "" ? "label.jpg" : cleaned;
}
