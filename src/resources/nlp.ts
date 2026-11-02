/**
 * `POST /v1/nlp`.
 *
 * A recording is transcribed by whisper.cpp. The text is a catalog search
 * of ten foods. Pass bytes the app already recorded, or pass the text itself.
 */

import type { TrackCore } from "../client.js";
import { ProtocolError } from "../errors.js";
import type { JsonObject, JsonValue } from "../json.js";
import type { LabelImage } from "./label.js";

export interface SearchSpeechOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly filename?: string | undefined;
  readonly contentType?: string | undefined;
}

/** Searches the catalog for [text]. whisper.cpp is not called. */
export async function searchText(
  client: TrackCore,
  text: string,
  options: SearchSpeechOptions = {},
): Promise<JsonObject> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/nlp",
    body: { text },
    timeoutMs: options.timeoutMs ?? 20_000,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return decodeNlp(response.body, response.status, response.requestId);
}

/** Sends a recording. whisper.cpp transcribes it, then the text is searched. */
export async function searchSpeech(
  client: TrackCore,
  audio: LabelImage,
  options: SearchSpeechOptions = {},
): Promise<JsonObject> {
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

function decodeNlp(body: JsonValue, status: number, requestId: string | null): JsonObject {
  if (!isObject(body) || typeof body["text"] !== "string" || !Array.isArray(body["results"])) {
    throw new ProtocolError("TrackCore's NLP response did not contain text and results.", { status, requestId });
  }
  return body;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function audioBlob(bytes: Uint8Array, type: string): Blob {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy as ArrayBuffer], { type });
}
