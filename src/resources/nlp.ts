/**
 * `POST /v1/nlp`.
 *
 * A recording is transcribed by whisper.cpp. The text is a catalog search
 * of ten foods. Pass bytes the app already recorded, or pass the text itself.
 */

import type { TrackCore } from "../client.js";
import { decodeNlpResult } from "../decode.js";
import { ProtocolError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { NlpResult } from "../models.js";
import type { LabelImage } from "./label.js";

export interface SearchSpeechOptions {
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
    body: { text },
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
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/nlp",
    rawBody: form,
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeNlp(response.body, response.status, response.requestId);
}

function decodeNlp(body: JsonValue, status: number, requestId: string | null): NlpResult {
  if (!isObject(body) || typeof body["text"] !== "string" || !Array.isArray(body["results"])) {
    throw new ProtocolError("TrackCore's NLP response did not contain text and results.", { status, requestId });
  }
  const result = decodeNlpResult(body);
  // A gateway from before itemisation sends no `items`; an empty list is what
  // it would have said, and keeps the field's type honest.
  return Array.isArray(result.items) ? result : { ...result, items: [] };
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function audioBlob(bytes: Uint8Array, type: string): Blob {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type });
}
