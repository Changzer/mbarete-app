import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Reads market photos — the product plus its handwritten price board — and
 * turns them into a draft catalog entry. The draft only ever pre-fills the
 * product form; a person proofreads and saves, so a misread digit costs a
 * correction, not a wrong price in the catalog.
 */

export const TRANSCRIBE_MODEL = "claude-opus-5";

/** More photos than this add cost without adding facts to read. */
export const MAX_TRANSCRIBE_IMAGES = 5;

/** Without a key the feature disappears from the UI; the form works as before. */
export function isTranscriptionEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type TranscribeImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  data: string; // base64, no data: prefix
};

export type TranscribeCategory = { id: number; nameEn: string; nameZh: string };

/** Everything is nullable: the model must leave unknowns empty, not guess. */
const transcriptionSchema = z.object({
  nameEn: z.string().nullable(),
  nameZh: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionZh: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  moq: z.number().nullable(),
  qtyPerBox: z.number().nullable(),
  categoryId: z.number().nullable(),
  notes: z.string().nullable(),
});

export type RawTranscription = z.infer<typeof transcriptionSchema>;

/** The subset of product-form fields a photo can fill. */
export type TranscribedFields = {
  nameEn?: string;
  nameZh?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  price?: number;
  currency?: string;
  moq?: number;
  qtyPerBox?: number;
  categoryId?: number;
};

export type TranscribeResult =
  | { ok: true; fields: TranscribedFields; notes: string | null }
  | { ok: false; error: "no-photos" | "not-configured" | "failed" };

const SYSTEM_PROMPT = `You transcribe supplier-booth photos into catalog entries for a sourcing company that buys wholesale goods at Chinese markets.

Each photo set shows one product (its packaging or the item itself) and usually a handwritten price board next to or below it.

Rules:
- Transcribe ONLY the main, centered product and the price board that belongs to it. Ignore products or boards partly visible at the edges of the frame.
- The boards are handwritten and the writers use a comma as the decimal separator: "10,20" means 10.20. A "¥" sign or an unmarked price at a Chinese market means CNY.
- "160/box", "160/ctn" or "160/箱" means 160 pieces per carton (qtyPerBox).
- MOQ may appear as "MOQ", "min" or "起订" and is in pieces unless the board clearly says boxes; if given in boxes, multiply by qtyPerBox.
- nameEn and nameZh are short catalog names: product type plus the key specs visible (count, size, material). Fill BOTH languages, translating whichever direction is needed. Never include the price in a name.
- Descriptions are one or two short sentences of facts visible in the photos; null when the name already says everything.
- categoryId must be an id from the category list you are given, or null when none fits. Never invent an id.
- Use null for anything not clearly readable — never guess a number.
- notes: one short line in English flagging uncertain readings (a doubtful digit, a partly hidden board) or information on the board that has no field, such as a per-box price. Null when there is nothing to flag.`;

export async function transcribeProductPhotos(
  images: TranscribeImage[],
  categories: TranscribeCategory[],
): Promise<TranscribeResult> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: TRANSCRIBE_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...images.map(
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
          {
            type: "text",
            text:
              `Available categories (id — English name / Chinese name):\n` +
              categories.map((c) => `${c.id} — ${c.nameEn} / ${c.nameZh}`).join("\n") +
              `\n\nTranscribe this product.`,
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(transcriptionSchema) },
  });

  if (!response.parsed_output) return { ok: false, error: "failed" };

  return {
    ok: true,
    ...sanitizeTranscription(
      response.parsed_output,
      new Set(categories.map((c) => c.id)),
    ),
  };
}

const CURRENCY_ALIASES: Record<string, string> = {
  RMB: "CNY", // how the model (and boards) often write Chinese yuan
  "¥": "CNY",
  US$: "USD",
  R$: "BRL",
};

/**
 * Keeps only values the form can safely hold: the model is told not to guess,
 * but a malformed value must degrade to an empty field, never break the form.
 */
export function sanitizeTranscription(
  raw: RawTranscription,
  validCategoryIds: Set<number>,
): { fields: TranscribedFields; notes: string | null } {
  const text = (v: string | null) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : undefined;
  };
  const positiveInt = (v: number | null) =>
    v !== null && Number.isFinite(v) && Math.round(v) >= 1 ? Math.round(v) : undefined;

  const price =
    raw.price !== null && Number.isFinite(raw.price) && raw.price >= 0
      ? Math.round(raw.price * 100) / 100
      : undefined;

  let currency = text(raw.currency)?.toUpperCase();
  if (currency) currency = CURRENCY_ALIASES[currency] ?? currency;
  if (currency && !/^[A-Z]{3}$/.test(currency)) currency = undefined;

  const categoryId =
    raw.categoryId !== null && validCategoryIds.has(raw.categoryId)
      ? raw.categoryId
      : undefined;

  return {
    fields: {
      nameEn: text(raw.nameEn),
      nameZh: text(raw.nameZh),
      descriptionEn: text(raw.descriptionEn),
      descriptionZh: text(raw.descriptionZh),
      price,
      currency,
      moq: positiveInt(raw.moq),
      qtyPerBox: positiveInt(raw.qtyPerBox),
      categoryId,
    },
    notes: text(raw.notes) ?? null,
  };
}
