"use server";

import { auth } from "@/lib/auth";

/**
 * Temporary diagnostic for evaluating Moonshot/Kimi as a transcription
 * backend, driven from /kimi-test. It runs from the server the app is
 * deployed on, so it tests the exact network path, key, and vision quality
 * a real integration would use — without touching the Anthropic modules.
 *
 * Delete together with src/app/[locale]/kimi-test and
 * src/components/kimi-test once the decision is made.
 */

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// The same market conventions the production product prompt uses, shrunk to a
// handful of fields — enough to judge reading quality on a real photo.
const SYSTEM_PROMPT = `You transcribe supplier-booth photos from Chinese wholesale markets. Handwritten price boards use a comma as the decimal separator: "10,20" means 10.20. A "¥" or unmarked price is CNY. "160/box" or "160/箱" means 160 pieces per carton. Transcribe only the main, centered product. Never guess an unclear digit — use null and mention it in notes.
Respond with a single JSON object with exactly these keys (null when not readable): {"nameEn": string|null, "nameZh": string|null, "price": number|null, "currency": string|null, "moq": number|null, "qtyPerBox": number|null, "notes": string|null}`;

export type KimiStep = { ok: boolean; ms: number; detail: string };

export type KimiTestResult =
  | { ok: false; error: "not-configured" }
  | {
      ok: true;
      baseUrl: string;
      model: string;
      keyCheck: KimiStep;
      extraction: KimiStep | null;
    };

async function step(run: () => Promise<{ ok: boolean; detail: string }>): Promise<KimiStep> {
  const started = Date.now();
  try {
    const result = await run();
    return { ...result, ms: Date.now() - started };
  } catch (error) {
    // A thrown fetch here usually means the server cannot reach the API at
    // all (DNS, firewall, timeout) — exactly what this page exists to reveal.
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, ms: Date.now() - started, detail };
  }
}

export async function runKimiTest(formData: FormData): Promise<KimiTestResult> {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");

  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) return { ok: false, error: "not-configured" };

  const baseUrl = (process.env.MOONSHOT_BASE_URL ?? "https://api.moonshot.cn/v1").replace(
    /\/+$/,
    "",
  );
  const model = process.env.MOONSHOT_MODEL ?? "kimi-latest";

  const keyCheck = await step(async () => {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 500)}` };
    try {
      const ids = (JSON.parse(body).data ?? [])
        .map((m: { id?: string }) => m.id)
        .filter(Boolean)
        .join(", ");
      return { ok: true, detail: `Key accepted. Available models: ${ids || "(none listed)"}` };
    } catch {
      return { ok: true, detail: `Key accepted. Raw response: ${body.slice(0, 300)}` };
    }
  });

  const files = formData
    .getAll("images")
    .filter(
      (f): f is File =>
        f instanceof File && f.size > 0 && f.size <= MAX_IMAGE_BYTES && IMAGE_TYPES.has(f.type),
    )
    .slice(0, 2);

  let extraction: KimiStep | null = null;
  if (files.length > 0) {
    const imageParts = await Promise.all(
      files.map(async (file) => ({
        type: "image_url" as const,
        image_url: {
          url: `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
        },
      })),
    );

    extraction = await step(async () => {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [...imageParts, { type: "text", text: "Transcribe this product as JSON." }],
            },
          ],
        }),
      });
      const body = await res.text();
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${body.slice(0, 600)}` };
      try {
        const parsed = JSON.parse(body);
        const content: string = parsed.choices?.[0]?.message?.content ?? "";
        const usage = parsed.usage
          ? ` (tokens: ${parsed.usage.prompt_tokens} in / ${parsed.usage.completion_tokens} out)`
          : "";
        return { ok: true, detail: `${content}${usage}` };
      } catch {
        return { ok: false, detail: `Unparseable response: ${body.slice(0, 600)}` };
      }
    });
  }

  return { ok: true, baseUrl, model, keyCheck, extraction };
}
