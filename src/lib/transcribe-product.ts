import { z } from "zod";
import { extractJson, type VisionImage } from "@/lib/vision";

/**
 * Reads market photos — the product plus its handwritten price board — and
 * turns them into a draft catalog entry. The draft only ever pre-fills the
 * product form; a person proofreads and saves, so a misread digit costs a
 * correction, not a wrong price in the catalog.
 */

export type { VisionImage as TranscribeImage } from "@/lib/vision";
export { isTranscriptionEnabled } from "@/lib/vision";

/** More photos than this add cost without adding facts to read. */
export const MAX_TRANSCRIBE_IMAGES = 5;

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
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  cbm: z.number().nullable(),
  notes: z.string().nullable(),
});

// Keep in sync with transcriptionSchema — this is what the JSON-mode backend
// is told to return.
const JSON_SPEC =
  '{"nameEn": string|null, "nameZh": string|null, "descriptionEn": string|null, "descriptionZh": string|null, "price": number|null, "currency": string|null, "moq": number|null, "qtyPerBox": number|null, "categoryId": number|null, "lengthCm": number|null, "widthCm": number|null, "heightCm": number|null, "weightKg": number|null, "cbm": number|null, "notes": string|null}';

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
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  weightKg?: number;
  cbm?: number;
};

export type TranscribeResult =
  | { ok: true; fields: TranscribedFields; notes: string | null }
  | { ok: false; error: "no-photos" | "not-configured" | "failed" };

const SYSTEM_PROMPT = `You transcribe supplier-booth photos into catalog entries for a sourcing company that buys wholesale goods at Chinese markets.

Each photo set shows one product (its packaging or the item itself) and usually a handwritten price board next to or below it. Our staff often use a standard whiteboard, one item per line: the price ("¥ 5.20"), "MOQ 5 pcs" or "MOQ 2 ctn", "QTY 12 pcs/ctn", "CBM 0.02", "KG 12", sometimes a booth number. Vendors' own boards are free-form — read them with the same rules.

Rules:
- Transcribe ONLY the main, centered product and the price board that belongs to it. Ignore products or boards partly visible at the edges of the frame.
- Boards are often handwritten with a comma as the decimal separator: "10,20" means 10.20. But a comma followed by exactly three digits ("1,200") is a thousands separator, so that means 1200. A "¥" sign or an unmarked price at a Chinese market means CNY.
- "160/box", "160/ctn" or "160/箱" means 160 pieces per carton (qtyPerBox).
- MOQ may appear as "MOQ", "min" or "起订" and is in pieces unless it clearly says cartons/boxes. A bare carton count on the board with no other label (e.g. "2 carton") is also the MOQ, in cartons. Whenever the MOQ is given in cartons, multiply by qtyPerBox and report pieces.
- lengthCm, widthCm, heightCm, weightKg and cbm are CARTON figures, and only when actually written on the board or packaging (e.g. "60x40x50", "KG 12", "CBM 0.02"). Never estimate them from how the product looks.
- nameEn and nameZh are short catalog names: product type plus the key specs visible (count, size, material). Fill BOTH languages, translating whichever direction is needed. Never include the price in a name.
- Descriptions are one or two short sentences of facts visible in the photos; null when the name already says everything.
- categoryId must be an id from the category list you are given, or null when none fits. Never invent an id.
- Use null for anything not clearly readable — never guess a number.
- notes: at most 15 words, in English, only for uncertain readings or board info that has no field. Null when there is nothing to flag.`;

export async function transcribeProductPhotos(
  images: VisionImage[],
  categories: TranscribeCategory[],
): Promise<TranscribeResult> {
  const raw = await extractJson({
    system: SYSTEM_PROMPT,
    userText:
      `Available categories (id — English name / Chinese name):\n` +
      categories.map((c) => `${c.id} — ${c.nameEn} / ${c.nameZh}`).join("\n") +
      `\n\nTranscribe this product.`,
    images,
    schema: transcriptionSchema,
    jsonSpec: JSON_SPEC,
  });

  if (!raw) return { ok: false, error: "failed" };

  return {
    ok: true,
    ...sanitizeTranscription(raw, new Set(categories.map((c) => c.id))),
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
  // Carton figures: zero means "not measured" in this app, so only positive
  // values are worth pre-filling.
  const measure = (v: number | null, decimals = 2) =>
    v !== null && Number.isFinite(v) && v > 0
      ? Math.round(v * 10 ** decimals) / 10 ** decimals
      : undefined;

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
      lengthCm: measure(raw.lengthCm),
      widthCm: measure(raw.widthCm),
      heightCm: measure(raw.heightCm),
      weightKg: measure(raw.weightKg),
      cbm: measure(raw.cbm, 4),
    },
    notes: text(raw.notes) ?? null,
  };
}
