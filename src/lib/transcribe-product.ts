import { z } from "zod";
import { isPlausibleCartonCbm } from "@/lib/calculations";
import { extractJson, type VisionImage, type VisionUsage } from "@/lib/vision";

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
  /**
   * The price board copied out character by character, before any figure is
   * interpreted. Reading first and deriving second stops the model settling
   * for a plausible-looking price instead of the one actually written, and
   * it lets a person see what the model thought it saw.
   */
  boardText: z.string().nullable(),
  /**
   * The factory's own style/model number printed on the packaging, label or
   * spec card (e.g. "AA012604240"). Optional so older stub servers and
   * truncated replies degrade to "no code", never to a failed parse.
   */
  supplierCode: z.string().nullable().optional(),
  /** 1-based index of the photo that best shows the product itself. */
  thumbImage: z.number().nullable().optional(),
  /** Tight box around the main product, in permille of that photo's size. */
  thumbBox: z
    .object({
      left: z.number(),
      top: z.number(),
      right: z.number(),
      bottom: z.number(),
    })
    .nullable()
    .optional(),
  nameEn: z.string().nullable(),
  nameZh: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionZh: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  moq: z.number().nullable(),
  qtyPerBox: z.number().nullable(),
  categoryId: z.number().nullable(),
  newCategoryEn: z.string().nullable(),
  newCategoryZh: z.string().nullable(),
  lengthCm: z.number().nullable(),
  widthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  weightKg: z.number().nullable(),
  cbm: z.number().nullable(),
  uncertain: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable(),
});

// Keep in sync with transcriptionSchema — this is what the JSON-mode backend
// is told to return.
const JSON_SPEC =
  '{"boardText": string|null, "supplierCode": string|null, "thumbImage": number|null, "thumbBox": {"left": number, "top": number, "right": number, "bottom": number}|null, "nameEn": string|null, "nameZh": string|null, "descriptionEn": string|null, "descriptionZh": string|null, "price": number|null, "currency": string|null, "moq": number|null, "qtyPerBox": number|null, "categoryId": number|null, "newCategoryEn": string|null, "newCategoryZh": string|null, "lengthCm": number|null, "widthCm": number|null, "heightCm": number|null, "weightKg": number|null, "cbm": number|null, "uncertain": string[]|null, "notes": string|null}';

export type RawTranscription = z.infer<typeof transcriptionSchema>;

/** The subset of product-form fields a photo can fill. */
export type TranscribedFields = {
  supplierCode?: string;
  /** Set by the offline draft read: the cropped thumbnail it already saved. */
  thumbPath?: string;
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
  /** Field names the model read with doubt — review looks at these first. */
  uncertain?: string[];
};

export type TranscribeResult =
  | {
      ok: true;
      fields: TranscribedFields;
      notes: string | null;
      /** What the model read off the board, shown so a misread is visible. */
      boardText: string | null;
      /** Category names proposed when nothing in the list fit; the server
       *  action resolves this into a real category (matching or creating). */
      proposedCategory: { nameEn: string; nameZh: string } | null;
      /** Set by the server action when the proposal became a real category. */
      newCategory?: { id: number; nameEn: string; nameZh: string };
      /** Where the main product sits in which photo, for the thumbnail crop. */
      thumb: { imageIndex: number; box: ThumbBox } | null;
      /** Set by the server action once the crop is saved to the uploads volume. */
      thumbPath?: string;
    }
  | { ok: false; error: "no-photos" | "not-configured" | "failed" | "limit" };

const SYSTEM_PROMPT = `You transcribe supplier-booth photos into catalog entries for a sourcing company that buys wholesale goods at Chinese markets.

Each photo set shows one product (its packaging or the item itself) and usually a handwritten price board next to or below it. Our staff often use a standard whiteboard, one item per line: the price ("¥ 5.20"), "MOQ 5 pcs" or "MOQ 2 ctn", "QTY 12 pcs/ctn", "CBM 0.02", "KG 12", sometimes a booth number. Vendors' own boards are free-form — read them with the same rules.

Work in two steps. FIRST copy the handwritten board into boardText exactly as written — every line, character by character, including the currency sign, punctuation and any word you are unsure of. Do not tidy it, convert it or reorder it. THEN read the fields below out of what you just copied. Never report a price, MOQ, quantity, weight or CBM that does not appear in boardText; if it is not there, the field is null.

The board is frequently photographed sideways or upside-down, because the paper is lying on a counter. Read it in whatever orientation it appears — turn it mentally until the writing is upright — and never skip it just because it is rotated.

Handwriting on these boards is quick and uneven. Take care with digits that look alike: 0 and 6, 1 and 7, 4 and 9, and a decimal point that is barely a dot. When two readings are genuinely possible, choose the one that makes commercial sense for a wholesale unit price and say so in notes.

Rules:
- supplierCode is the factory's own style/model number printed on the packaging, label or spec sheet (e.g. "AA012604240", "XH-238"). Copy it exactly as printed. A booth number, a price or a barcode's digits are NOT a style number; null when nothing printed reads as one. Never put this code inside nameEn or nameZh.
- thumbImage and thumbBox locate the main product for a thumbnail crop: thumbImage is the 1-based index of the photo that shows the product itself most clearly (never a photo that is mostly the price board), and thumbBox is the tight bounding box around that product in permille of the photo's width and height — integers 0-1000, left < right, top < bottom. Both null when no photo clearly shows the product.
- Transcribe ONLY the main, centered product and the price board that belongs to it. Ignore products or boards partly visible at the edges of the frame.
- Boards are often handwritten with a comma as the decimal separator: "10,20" means 10.20. But a comma followed by exactly three digits ("1,200") is a thousands separator, so that means 1200. A "¥" sign or an unmarked price at a Chinese market means CNY.
- "160/box", "160/ctn" or "160/箱" means 160 pieces per carton (qtyPerBox).
- MOQ may appear as "MOQ", "min" or "起订" and is in pieces unless it clearly says cartons/boxes. A bare carton count on the board with no other label (e.g. "2 carton") is also the MOQ, in cartons. Whenever the MOQ is given in cartons, multiply by qtyPerBox and report pieces.
- When a board gives a carton MOQ and a separate piece count with no per-carton marking (e.g. "MOQ 3 box" above "QTY 360 pcs"), the piece count is the total for that minimum order: report moq 360 and qtyPerBox 120 (360 ÷ 3), and say in notes that the split was derived. Only when the piece count is explicitly marked per carton ("360 pcs/ctn") does it become qtyPerBox directly.
- lengthCm, widthCm, heightCm, weightKg and cbm are CARTON figures, and only when actually written on the board or packaging (e.g. "60x40x50", "KG 12", "CBM 0.02"). Never estimate them from how the product looks.
- nameEn and nameZh are short catalog names: product type plus the key specs visible (count, size, material). Fill BOTH languages, translating whichever direction is needed — including from packaging in any other language. When the photos show an identifiable product, construct the names from what it is; never leave them null. Never include the price in a name.
- Descriptions are one or two short sentences of facts visible in the photos; null when the name already says everything.
- categoryId must be an id from the category list you are given, or null when none fits. Never invent an id. When it is null but the product clearly belongs to a category the list is missing, propose one via newCategoryEn and newCategoryZh — a short, general product-type name in BOTH languages (e.g. "Stationery" / "文具", "Beauty Tools" / "美妆工具"), never a name as specific as the product itself. Both null when an existing category fits.
- Use null for anything not clearly readable — never guess a number.
- A bare quantity with no MOQ/min/起订 marking (e.g. "1500 pc" on its own) is NOT the MOQ: leave moq null, copy it into notes, and list "moq" in uncertain.
- uncertain: the names of the fields above whose reading you are not confident of (e.g. ["price", "moq"]) — a smudged digit, a comma that could be either separator, a quantity of unclear meaning. Empty or null when every field is clear.
- notes: at most 15 words, in English, only for uncertain readings or board info that has no field. Null when there is nothing to flag.`;

export async function transcribeProductPhotos(
  images: VisionImage[],
  categories: TranscribeCategory[],
  onUsage?: (usage: VisionUsage) => void,
): Promise<TranscribeResult> {
  const raw = await extractJson({
    onUsage,
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
    ...sanitizeTranscription(raw, new Set(categories.map((c) => c.id)), images.length),
  };
}

export type ThumbBox = { left: number; top: number; right: number; bottom: number };

/**
 * The crop the model proposed, or null when it is unusable: a permille box
 * must sit inside the photo, read left-to-right and top-to-bottom, and cover
 * a sensible area — a sliver or the whole frame crops nothing worth showing.
 */
export function sanitizeThumb(
  imageIndex: number | null | undefined,
  box: ThumbBox | null | undefined,
  imageCount: number,
): { imageIndex: number; box: ThumbBox } | null {
  if (!box || imageIndex == null) return null;
  if (!Number.isInteger(imageIndex) || imageIndex < 1 || imageIndex > imageCount) return null;
  const values = [box.left, box.top, box.right, box.bottom];
  if (!values.every((v) => Number.isFinite(v))) return null;
  const clamp = (v: number) => Math.min(1000, Math.max(0, Math.round(v)));
  const clean = {
    left: clamp(box.left),
    top: clamp(box.top),
    right: clamp(box.right),
    bottom: clamp(box.bottom),
  };
  // Under 5% of a side is a misfire, not a product.
  if (clean.right - clean.left < 50 || clean.bottom - clean.top < 50) return null;
  return { imageIndex, box: clean };
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
  imageCount = 0,
): {
  fields: TranscribedFields;
  notes: string | null;
  boardText: string | null;
  proposedCategory: { nameEn: string; nameZh: string } | null;
  thumb: { imageIndex: number; box: ThumbBox } | null;
} {
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

  // Three dimensions on the board make the CBM arithmetic, not a reading:
  // the form computes it from them, so a model's own figure beside them is
  // dropped — one reading put "15" next to a 60×45×42 carton (0.11 m³),
  // and that 15 became the product's volume. A standalone CBM survives
  // only when it could be a carton at all.
  const lengthCm = measure(raw.lengthCm);
  const widthCm = measure(raw.widthCm);
  const heightCm = measure(raw.heightCm);
  const readCbm = measure(raw.cbm, 4);
  const cbm =
    lengthCm && widthCm && heightCm
      ? undefined
      : readCbm !== undefined && isPlausibleCartonCbm(readCbm)
        ? readCbm
        : undefined;

  // Names of fields the model doubted; absent (not empty) when it doubted none.
  const uncertain = Array.isArray(raw.uncertain)
    ? raw.uncertain.filter((f): f is string => typeof f === "string" && f.length <= 40).slice(0, 8)
    : [];

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

  // A proposal only counts when no existing category matched and both names
  // are present — the categories table requires a name in each language.
  const newEn = text(raw.newCategoryEn);
  const newZh = text(raw.newCategoryZh);
  const proposedCategory =
    categoryId === undefined && newEn && newZh ? { nameEn: newEn, nameZh: newZh } : null;

  return {
    fields: {
      supplierCode: text(raw.supplierCode ?? null),
      nameEn: text(raw.nameEn),
      nameZh: text(raw.nameZh),
      descriptionEn: text(raw.descriptionEn),
      descriptionZh: text(raw.descriptionZh),
      price,
      currency,
      moq: positiveInt(raw.moq),
      qtyPerBox: positiveInt(raw.qtyPerBox),
      categoryId,
      lengthCm,
      widthCm,
      heightCm,
      weightKg: measure(raw.weightKg),
      cbm,
      ...(uncertain.length > 0 ? { uncertain } : {}),
    },
    notes: text(raw.notes) ?? null,
    boardText: text(raw.boardText) ?? null,
    proposedCategory,
    thumb: sanitizeThumb(raw.thumbImage, raw.thumbBox ?? null, imageCount),
  };
}
