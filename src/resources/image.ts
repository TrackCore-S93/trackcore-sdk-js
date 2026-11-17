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
import { AbortError, ProtocolError } from "../errors.js";
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

/** The most photos one {@link recognizeFoodPhotos} or {@link recognizeFridgePhotos} call takes. */
export const MAX_PHOTOS_PER_CALL = 10;

export interface RecognizePhotosOptions extends RecognizeImageOptions {
  /**
   * How many photos are being sent at once. Default 2, at most 4. The server
   * resizes large photos one at a time, so more than this gains nothing.
   */
  readonly concurrency?: number | undefined;
}

/** What happened to one photo of a several-photo scan. */
export interface PhotoScan {
  /** The photo's position in the list that was passed in, from 0. */
  readonly index: number;
  /**
   * `"ok"` and `"no_match"` are the server's own answer for this photo.
   * `"failed"` means this photo's request threw; see `error`.
   */
  readonly status: "ok" | "no_match" | "failed";
  /** The foods recognised in this photo. Empty unless `status` is `"ok"`. */
  readonly items: readonly JsonValue[];
  /** The server's whole answer for this photo, as a single-photo call returns it. `null` when it failed. */
  readonly result: JsonObject | null;
  /** What this photo's request threw, normally a `TrackCoreError`. `null` unless `status` is `"failed"`. */
  readonly error: unknown;
}

/**
 * Several photos scanned as one meal or one fridge.
 *
 * `status`, `result_kind` and `items` have the meaning they have on a
 * single-photo result, so code that renders one renders this.
 */
export interface PhotosRecognition {
  /** `"ok"` when any photo had a food in it, `"no_match"` when none did. */
  readonly status: "ok" | "no_match";
  /** As the server names it. */
  readonly result_kind: string;
  /** Every photo's foods, in the order the photos were passed. A food seen in two photos is in here twice. */
  readonly items: readonly JsonValue[];
  /** One entry per photo, in the order they were passed. */
  readonly photos: readonly PhotoScan[];
  /** How many photos failed. Their entries in `photos` carry the error. */
  readonly failed: number;
}

/**
 * Scans several photos of one meal and returns them as one result.
 *
 * The API takes one photo per request, so each photo is its own
 * `POST /v1/image/food`: its own timeout, its own retries, and its own
 * metered scan. Up to {@link MAX_PHOTOS_PER_CALL} photos.
 *
 * One photo failing does not lose the others: it is reported in `photos`
 * and counted in `failed`. The call throws only when every photo failed
 * (the first photo's error), when the caller's `signal` aborts, or when the
 * list is empty or too long.
 */
export function recognizeFoodPhotos(
  client: TrackCore,
  images: readonly LabelImage[],
  options: RecognizePhotosOptions = {},
): Promise<PhotosRecognition> {
  return recognizeMany(client, "food", images, options);
}

/** Scans several photos of one fridge. Same behaviour as {@link recognizeFoodPhotos}. */
export function recognizeFridgePhotos(
  client: TrackCore,
  images: readonly LabelImage[],
  options: RecognizePhotosOptions = {},
): Promise<PhotosRecognition> {
  return recognizeMany(client, "fridge", images, options);
}

async function recognizeMany(
  client: TrackCore,
  kind: "food" | "fridge",
  images: readonly LabelImage[],
  options: RecognizePhotosOptions,
): Promise<PhotosRecognition> {
  if (!Array.isArray(images) || images.length === 0) {
    throw new TypeError("At least one photo is required.");
  }
  if (images.length > MAX_PHOTOS_PER_CALL) {
    throw new RangeError(`At most ${MAX_PHOTOS_PER_CALL} photos can be scanned in one call; ${images.length} were passed.`);
  }
  const requested = options.concurrency ?? 2;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError("concurrency must be a whole number of at least 1.");
  }
  const lanes = Math.min(requested, 4, images.length);
  const { concurrency: _unused, filename: _name, ...each } = options;
  void _unused;
  void _name;

  const photos = new Array<PhotoScan>(images.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= images.length) return;
      // A photo that has not gone out yet is not sent once the caller has
      // given up; it is recorded as failed and the abort is thrown below.
      if (options.signal?.aborted === true) {
        photos[index] = { index, status: "failed", items: [], result: null, error: new AbortError() };
        continue;
      }
      try {
        const result = await recognize(client, kind, images[index] as LabelImage, each);
        const items = result["items"] as JsonValue[];
        const matched = result["status"] !== "no_match" && items.length > 0;
        photos[index] = { index, status: matched ? "ok" : "no_match", items: matched ? items : [], result, error: null };
      } catch (error) {
        photos[index] = { index, status: "failed", items: [], result: null, error };
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));

  // The caller giving up is one thing to report, whatever each photo was
  // doing at the time: the same error a single-photo call throws.
  if (options.signal?.aborted === true) throw new AbortError();
  const failures = photos.filter((photo) => photo.status === "failed");
  if (failures.length === photos.length) throw (failures[0] as PhotoScan).error;
  const first = photos.find((photo) => photo.result !== null) as PhotoScan;
  const items = photos.flatMap((photo) => photo.items);
  return {
    status: items.length > 0 ? "ok" : "no_match",
    result_kind: (first.result as JsonObject)["result_kind"] as string,
    items,
    photos,
    failed: failures.length,
  };
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
