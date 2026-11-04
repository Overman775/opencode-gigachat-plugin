import { randomUUID } from "node:crypto";
import { default as axios } from "axios";
import { default as FormData } from "form-data";
import { GIGACHAT_FILES_URL } from "../constants.js";
import { sanitizeError } from "../gigacode/auth.js";
import { getHttpsAgent } from "../gigacode/certs.js";
import { headersToRecord, removeHeaderCaseInsensitive } from "./routing.js";

export interface AttachmentOptions {
  filesUrl?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
}
// Uploads base64 image data to GigaChat /files endpoint and returns file_id
export async function uploadBase64File(
  base64DataUrl: string,
  token: string,
  verifySsl: boolean,
  caBundle: string,
  options: AttachmentOptions = {},
): Promise<string> {
  const matches = base64DataUrl.match(
    /^data:([A-Za-z0-9\-+.\/]+);base64,(.+)$/,
  );
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 data URL format");
  }

  const mimeType = matches[1];
  const dataString = matches[2];
  if (!mimeType || !dataString) {
    throw new Error("Invalid base64 data URL parts");
  }

  const buffer = Buffer.from(dataString, "base64");

  let ext = "png";
  if (mimeType.includes("jpeg")) ext = "jpg";
  else if (mimeType.includes("webp")) ext = "webp";
  else if (mimeType.includes("gif")) ext = "gif";
  else if (mimeType.includes("mpeg") || mimeType.includes("mp3")) ext = "mp3";
  else if (mimeType.includes("wav")) ext = "wav";
  else if (mimeType.includes("ogg")) ext = "ogg";
  else if (mimeType.includes("webm")) ext = "webm";
  else if (mimeType.includes("flac")) ext = "flac";
  else if (mimeType.includes("mp4") || mimeType.includes("m4a")) ext = "m4a";
  else if (mimeType.includes("aac")) ext = "aac";

  const tempFileName = `upload_${Date.now()}.${ext}`;

  const form = new FormData();
  form.append("file", buffer, {
    filename: tempFileName,
    contentType: mimeType,
  });
  form.append("purpose", "general");

  const customHeaders = headersToRecord(options.headers);
  for (const name of [
    "authorization",
    "content-type",
    "content-length",
    "x-opencode-provider-marker",
  ]) {
    removeHeaderCaseInsensitive(customHeaders, name);
  }
  const headers = {
    ...customHeaders,
    ...form.getHeaders(),
    Authorization: `Bearer ${token}`,
    RqUID: randomUUID(),
  };

  const httpsAgent = getHttpsAgent(verifySsl, caBundle);

  try {
    const response = await axios.post(
      options.filesUrl ?? GIGACHAT_FILES_URL,
      form,
      {
        headers,
        httpsAgent,
        timeout: 30000,
        signal: options.signal,
      },
    );
    if (typeof response.data?.id !== "string" || !response.data.id.trim()) {
      throw new Error("No file ID returned in GigaChat upload response");
    }
    return response.data.id;
  } catch (err: unknown) {
    throw sanitizeError(err);
  }
}
