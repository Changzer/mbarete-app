import { z } from "zod";

/**
 * Validation for the public waiting-list form, kept out of the action module
 * so it can be tested directly: a "use server" file may only export async
 * functions, so the schema itself cannot live there.
 *
 * There is deliberately no phone-number format here. The first version demanded
 * a mainland-China mobile, which quietly excluded the import teams outside
 * China that the page is written for — and a WeChat ID is not a phone number at
 * all. The field takes whatever handle someone actually answers on, and takes
 * nothing at all if they would rather just leave an email.
 */
export const waitlistSchema = z.object({
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  preferredContact: z
    .string()
    .trim()
    .max(200)
    // An empty field and an absent field are the same intent: no handle given.
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
