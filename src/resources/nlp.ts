/**
 * `POST /v1/nlp`.
 *
 * A recording is transcribed by whisper.cpp. The text is split into the foods
 * it names and each is resolved. Pass bytes the app already recorded, or pass
 * the text itself. Pass `context` to change a meal already described.
 */

import type { TrackCore } from "../client.js";
import { decodeNlpResult } from "../decode.js";
import { ProtocolError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { CookingMethod, NlpResult } from "../models.js";
import type { LabelImage } from "./label.js";

export interface SearchSpeechOptions {
  /**
   * How the food was cooked, one of the six answers the app offers. Steers
   * every item's catalogue search towards the cooked form ("chicken breast"
   * with `grilled` is searched as "grilled chicken breast") and is echoed
   * back as `cooking_method`. Pass the same value to `diary.logFood`.
   */
  readonly cookingMethod?: CookingMethod | undefined;
  /**
   * The meal so far, for a follow-up: what the user has already said about
   * this meal. Pass the previous result's `text`. The new sentence or
   * recording is then applied to it ("and a banana", "make that two eggs",
   * "remove the chicken breast") and the result is the whole meal as it now
   * stands, not just what was added.
   *
   * At most 1000 characters; a longer one is refused with a `RequestError`
   * whose reason is `context_too_long`. Nothing is stored between calls, so send it every
   * time. Omit it, or pass a blank string, for a first sentence.
   */
  readonly context?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly filename?: string | undefined;
  readonly contentType?: string | undefined;
}

/**
 * Turns [text] into foods with servings and quantities. whisper.cpp is not
 * called; the sentence goes straight to extraction and resolution.
 */
export async function searchText(
  client: TrackCore,
  text: string,
  options: SearchSpeechOptions = {},
): Promise<NlpResult> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/nlp",
    body: hasContext(options.context) ? { text, context: options.context } : { text },
    ...(options.cookingMethod === undefined ? {} : { query: { cooking_method: options.cookingMethod } }),
    timeoutMs: options.timeoutMs ?? 20_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeNlp(response.body, response.status, response.requestId);
}

/** Sends a recording. whisper.cpp transcribes it, then the transcript is resolved like [searchText]. */
export async function searchSpeech(
  client: TrackCore,
  audio: LabelImage,
  options: SearchSpeechOptions = {},
): Promise<NlpResult> {
  const form = new FormData();
  const blob = audio instanceof Blob ? audio : audioBlob(audio.bytes, options.contentType ?? audio.contentType ?? "audio/wav");
  const filename = options.filename ?? (!(audio instanceof Blob) ? audio.filename : undefined) ?? "speech.wav";
  form.append("audio", blob, filename.replace(/[\r\n"]/g, "").trim() || "speech.wav");
  if (hasContext(options.context)) form.append("context", options.context);
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/nlp",
    rawBody: form,
    ...(options.cookingMethod === undefined ? {} : { query: { cooking_method: options.cookingMethod } }),
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeNlp(response.body, response.status, response.requestId);
}

function decodeNlp(body: JsonValue, status: number, requestId: string | null): NlpResult {
  if (!isObject(body) || typeof body["text"] !== "string" || !Array.isArray(body["results"])) {
    throw new ProtocolError("TrackCore's NLP response did not contain text and results.", { status, requestId });
  }
  const decoded = decodeNlpResult(body);
  // A gateway from before follow-ups sends no `transcript`. One sentence was
  // said and `text` is it, which is what `transcript` means on a first call.
  const result = typeof decoded.transcript === "string" ? decoded : { ...decoded, transcript: decoded.text };
  // A gateway from before itemisation sends no `items`; an empty list is what
  // it would have said, and keeps the field's type honest.
  return Array.isArray(result.items) ? result : { ...result, items: [] };
}

/** A blank context is no context: the call is a first sentence. */
function hasContext(context: string | undefined): context is string {
  return typeof context === "string" && context.trim() !== "";
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function audioBlob(bytes: Uint8Array, type: string): Blob {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type });
}
