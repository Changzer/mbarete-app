import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { TRANSCRIBE_MODEL, type TranscribeImage } from "@/lib/transcribe-product";

/**
 * Reads photos of a vendor's business card (front and back) into a draft
 * contact. Same posture as product transcription: the draft only pre-fills
 * the contact form, a person proofreads before saving — and the card photos
 * themselves stay attached to the contact as the system of record for
 * anything the transcription can't carry (the WeChat QR) or must never be
 * trusted on (bank account digits).
 */

/** The subset of contact fields a card can fill. */
export type TranscribedContactFields = {
  companyName?: string;
  companyNameZh?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  wechat?: string;
  boothLocation?: string;
  bankInfo?: string;
};

export type CardTranscribeResult =
  | { ok: true; fields: TranscribedContactFields; notes: string | null }
  | { ok: false; error: "no-photos" | "not-configured" | "failed" };

/** Everything nullable: the model must leave unknowns empty, never guess. */
const cardSchema = z.object({
  companyNameEn: z.string().nullable(),
  companyNameZh: z.string().nullable(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  whatsapp: z.string().nullable(),
  wechat: z.string().nullable(),
  boothLocation: z.string().nullable(),
  bankInfo: z.string().nullable(),
  notes: z.string().nullable(),
});

export type RawCardTranscription = z.infer<typeof cardSchema>;

const SYSTEM_PROMPT = `You transcribe photos of a supplier's business card (front and/or back, taken at a Chinese wholesale market) into a contact record for a sourcing company whose staff read English, not Chinese.

Rules:
- companyNameEn: the company's English or latin name. If the card only prints a Chinese name, translate or transliterate it (e.g. 瑶瑶饰品 -> "YaoYao Accessories"). Always fill this when any company name is visible.
- companyNameZh: the Chinese company name exactly as printed; null on latin-only cards.
- contactPerson: as printed, with pinyin added for Chinese names so non-readers can say it: "陈瑶 (Chen Yao)".
- phone: every phone/mobile number on the card, joined with " / ". Digits exactly as printed — never guess an unclear digit; drop it and flag it in notes instead.
- wechat: ONLY an explicitly printed WeChat ID, or the phone number when the card says 微信同号 (WeChat = phone). A QR code is NOT a WeChat ID — never invent one from a QR; mention the QR in notes instead.
- boothLocation: the market booth/shop address, English first when the card prints both, with the Chinese original after it, e.g. "No.4642, Street 9, Area C, 2/F, District 1, Yiwu International Trade City (义乌国际商贸城一区2楼C区9街4642店)". A separate factory address (厂址) goes in notes, not here.
- bankInfo: bank accounts from the card, one per line as "Bank — account holder — account number" (e.g. "工商银行 — 陈云娟 — 6222 0312 0800 2746 705"). Keep the printed digit grouping. Transcribe the account holder exactly — it is often a different person than the contact. Never guess a digit: if any digit is unclear, leave that whole account out and say so in notes.
- notes: one or two short lines in English for anything else useful — a factory address, "WeChat QR on card back", an unreadable digit you skipped. Null when there is nothing.
- Use null for anything not clearly readable.`;

export async function transcribeBusinessCard(
  images: TranscribeImage[],
): Promise<CardTranscribeResult> {
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
          { type: "text", text: "Transcribe this business card." },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(cardSchema) },
  });

  if (!response.parsed_output) return { ok: false, error: "failed" };

  return { ok: true, ...sanitizeCardTranscription(response.parsed_output) };
}

/** Trims everything; a malformed value degrades to an empty field. */
export function sanitizeCardTranscription(raw: RawCardTranscription): {
  fields: TranscribedContactFields;
  notes: string | null;
} {
  const text = (v: string | null) => {
    const trimmed = v?.trim();
    return trimmed ? trimmed : undefined;
  };

  return {
    fields: {
      companyName: text(raw.companyNameEn),
      companyNameZh: text(raw.companyNameZh),
      contactPerson: text(raw.contactPerson),
      phone: text(raw.phone),
      email: text(raw.email),
      whatsapp: text(raw.whatsapp),
      wechat: text(raw.wechat),
      boothLocation: text(raw.boothLocation),
      bankInfo: text(raw.bankInfo),
    },
    notes: text(raw.notes) ?? null,
  };
}
