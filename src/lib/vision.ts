import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * The one place that talks to a vision model. Two interchangeable backends:
 *
 * - Moonshot/Kimi (OpenAI-compatible, api.moonshot.cn) — the default when its
 *   key is set, because the server usually runs in mainland China where it is
 *   fast and reliable. kimi-k2.6 with thinking disabled measured ~4s per
 *   photo against ~60s with thinking left on.
 * - Anthropic/Claude — the fallback, for servers outside China.
 *
 * Callers hand over a prompt, images and a zod schema; whichever backend runs,
 * the result is validated against the schema and the caller's sanitizer, so a
 * provider switch never changes what the rest of the app sees.
 */

export type VisionImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64, no data: prefix
};

export type VisionProvider = "moonshot" | "anthropic";

/** What one call cost, as the provider reported it. */
export type VisionUsage = {
  provider: VisionProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

const ANTHROPIC_MODEL = "claude-opus-5";

export function visionProvider(): VisionProvider | null {
  // `||` everywhere, not `??`: docker-compose passes unset vars through as
  // empty strings.
  const forced = process.env.TRANSCRIBE_PROVIDER || "";
  const hasMoonshot = Boolean(process.env.MOONSHOT_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  if (forced === "anthropic") return hasAnthropic ? "anthropic" : null;
  if (forced === "moonshot") return hasMoonshot ? "moonshot" : null;
  if (hasMoonshot) return "moonshot";
  if (hasAnthropic) return "anthropic";
  return null;
}

/** Without a key the AI buttons disappear; the forms work by hand as before. */
export function isTranscriptionEnabled() {
  return visionProvider() !== null;
}

export async function extractJson<S extends z.ZodType>(opts: {
  system: string;
  userText: string;
  images: VisionImage[];
  schema: S;
  /** Compact key spec appended to the prompt so the model knows the keys. */
  jsonSpec: string;
  /** Told the token bill whenever the provider reports one — even when the
   *  answer then fails to parse, because the spend already happened. */
  onUsage?: (usage: VisionUsage) => void;
}): Promise<z.infer<S> | null> {
  const provider = visionProvider();
  if (provider === "moonshot") return extractWithMoonshot(opts);
  if (provider === "anthropic") return extractWithAnthropic(opts);
  return null;
}

/**
 * NOT structured outputs: the API caps schemas at 16 union-typed parameters
 * and the product schema's nullable fields count 21, so output_config gets
 * a 400 before the model sees a photo. Both backends therefore work the
 * same way — the key spec rides in the prompt and the answer is validated
 * here, which keeps them interchangeable.
 */
async function extractWithAnthropic<S extends z.ZodType>(opts: {
  system: string;
  userText: string;
  images: VisionImage[];
  schema: S;
  jsonSpec: string;
  onUsage?: (usage: VisionUsage) => void;
}): Promise<z.infer<S> | null> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: `${opts.system}\n\nRespond with a single JSON object with exactly these keys (null when unknown): ${opts.jsonSpec}\nOutput only the JSON object — no prose, no code fences.`,
    messages: [
      {
        role: "user",
        content: [
          ...opts.images.map(
            (image) =>
              ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: image.data,
                },
              }) as const,
          ),
          { type: "text", text: opts.userText },
        ],
      },
    ],
  });
  opts.onUsage?.({
    provider: "anthropic",
    model: ANTHROPIC_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
  const content = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  return parseModelJson(content, opts.schema);
}

/** The model's text answer, defensively unfenced, parsed and validated. */
function parseModelJson<S extends z.ZodType>(content: string, schema: S): z.infer<S> | null {
  const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function extractWithMoonshot<S extends z.ZodType>(opts: {
  system: string;
  userText: string;
  images: VisionImage[];
  schema: S;
  jsonSpec: string;
  onUsage?: (usage: VisionUsage) => void;
}): Promise<z.infer<S> | null> {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1").replace(
    /\/+$/,
    "",
  );
  const model = process.env.MOONSHOT_MODEL || "kimi-k2.6";
  // Thinking off by default: measured 3.7s vs 58s on the same photo, with the
  // BETTER reading. MOONSHOT_DISABLE_THINKING=0 restores the model default
  // for models that reject the field.
  const instant = (process.env.MOONSHOT_DISABLE_THINKING || "1") !== "0";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(90_000),
    // Deliberately no temperature/top_p/penalties: Moonshot fixes these per
    // model and rejects overrides.
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      ...(instant ? { thinking: { type: "disabled" } } : {}),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${opts.system}\n\nRespond with a single JSON object with exactly these keys (null when unknown): ${opts.jsonSpec}`,
        },
        {
          role: "user",
          content: [
            ...opts.images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: `data:${image.mediaType};base64,${image.data}` },
            })),
            { type: "text" as const, text: opts.userText },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`moonshot ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (body.usage) {
    opts.onUsage?.({
      provider: "moonshot",
      model,
      inputTokens: body.usage.prompt_tokens ?? 0,
      outputTokens: body.usage.completion_tokens ?? 0,
    });
  }
  const content = body.choices?.[0]?.message?.content ?? "";
  return parseModelJson(content, opts.schema);
}
