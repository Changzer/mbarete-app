"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("unauthorized");
}

const rateSchema = z.object({
  // Free-form so "RMB" and "CNY" can both exist if that is how suppliers quote.
  currencyCode: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .transform((s) => s.toUpperCase()),
  rateToUsd: z.coerce.number().positive(),
});

export async function upsertExchangeRate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireSession();

  const parsed = rateSchema.safeParse({
    currencyCode: formData.get("currencyCode"),
    rateToUsd: formData.get("rateToUsd"),
  });
  if (!parsed.success) return "invalid";
  const { currencyCode, rateToUsd } = parsed.data;

  const existing = db
    .select()
    .from(exchangeRates)
    .where(eq(exchangeRates.currencyCode, currencyCode))
    .get();

  if (existing) {
    db.update(exchangeRates)
      .set({ rateToUsd, updatedAt: new Date().toISOString() })
      .where(eq(exchangeRates.currencyCode, currencyCode))
      .run();
  } else {
    db.insert(exchangeRates).values({ currencyCode, rateToUsd }).run();
  }

  revalidatePath("/settings");
  revalidatePath("/orders");
  return undefined;
}

export async function deleteExchangeRate(currencyCode: string) {
  await requireSession();
  if (currencyCode === "USD") return; // USD is the peg; removing it breaks conversion
  db.delete(exchangeRates).where(eq(exchangeRates.currencyCode, currencyCode)).run();
  revalidatePath("/settings");
  revalidatePath("/orders");
}
