import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { default as axios } from "axios";

import { GIGACHAT_API_URL } from "../constants.js";
import { sanitizeError } from "../gigacode/auth.js";
import { getHttpsAgent } from "../gigacode/certs.js";
import { logger } from "../gigacode/logger.js";

/**
 * Image generation through the built-in `text2image` function.
 *
 * The v1 contract needs `function_call: "auto"` in the request, which the chat
 * translation never sends (OpenCode always brings its own tools), so this path
 * talks to the Sber API directly instead of going through the local endpoint.
 * The model returns `<img src="<file id>"/>` and the bytes are fetched from
 * `/files/{id}/content` (see docs: guides/images-generation).
 */
export interface ImageGenerationRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly path?: string;
  readonly directory?: string;
}

export interface ImageGenerationResult {
  readonly path: string;
  readonly fileId: string;
  readonly text: string;
}

export interface ImageGenerationConnection {
  readonly token: string;
  readonly verifySsl: boolean;
  readonly caBundle: string;
  readonly upstreamBaseUrl?: string;
  readonly signal?: AbortSignal;
}

export const DEFAULT_IMAGE_MODEL = "GigaChat-2-Max";

const IMAGE_TAG = /<img[^>]*src="([^">]+)"[^>]*>/i;

/** Pulls the generated file id out of the assistant message content. */
export function extractImageId(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  return IMAGE_TAG.exec(content)?.[1];
}

/** Request body for the built-in function call. */
export function buildImageRequestBody(
  prompt: string,
  model: string,
): Record<string, unknown> {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    function_call: "auto",
  };
}

/** Target file name: the prompt is kept out of it, timestamps keep it unique. */
export function resolveImagePath(
  requested: string | undefined,
  directory: string | undefined,
): string {
  if (requested && requested.trim()) {
    const trimmed = requested.trim();
    return isAbsolute(trimmed)
      ? trimmed
      : resolve(directory ?? process.cwd(), trimmed);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(directory ?? process.cwd(), `gigachat-image-${stamp}.jpg`);
}

function upstreamBase(connection: ImageGenerationConnection): string {
  return (
    connection.upstreamBaseUrl ??
    process.env.GIGACHAT_API_URL ??
    GIGACHAT_API_URL
  ).replace(/\/$/, "");
}

function requestOptions(connection: ImageGenerationConnection) {
  return {
    httpsAgent: getHttpsAgent(connection.verifySsl, connection.caBundle),
    timeout: 120000,
    signal: connection.signal,
  };
}

function authHeaders(connection: ImageGenerationConnection): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${connection.token}`,
    RqUID: randomUUID(),
  };
}

export async function generateImage(
  request: ImageGenerationRequest,
  connection: ImageGenerationConnection,
): Promise<ImageGenerationResult> {
  const model = request.model?.trim() || DEFAULT_IMAGE_MODEL;
  const base = upstreamBase(connection);

  try {
    logger.log(`Requesting image generation from ${model}...`);
    const chat = await axios.post<{
      choices?: { message?: { content?: unknown } }[];
    }>(
      `${base}/chat/completions`,
      buildImageRequestBody(request.prompt, model),
      { ...requestOptions(connection), headers: authHeaders(connection) },
    );

    const content = chat.data.choices?.[0]?.message?.content;
    const fileId = extractImageId(content);
    if (!fileId) {
      const text = typeof content === "string" ? content.trim() : "";
      throw new Error(
        text
          ? `GigaChat did not return an image. Model answer: ${text.slice(0, 300)}`
          : "GigaChat did not return an image for this prompt",
      );
    }

    const download = await axios.get<ArrayBuffer>(`${base}/files/${fileId}/content`, {
      ...requestOptions(connection),
      headers: {
        Accept: "application/jpg",
        Authorization: `Bearer ${connection.token}`,
        RqUID: randomUUID(),
      },
      responseType: "arraybuffer",
    });

    const target = resolveImagePath(request.path, request.directory);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(download.data));
    logger.log(`Image saved to ${target}`);

    return {
      path: target,
      fileId,
      text: typeof content === "string" ? content : "",
    };
  } catch (error: unknown) {
    throw sanitizeError(error);
  }
}
