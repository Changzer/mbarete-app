import { db } from "@/db";
import { authTokens } from "@/db/schema";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { recordError } from "@/lib/monitoring";
import { hashInviteToken, newInviteToken, isoIn } from "@/lib/invites";

const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The public origin for links in emails. On the NAS this is the LAN URL. */
export function appOrigin(): string {
  return process.env.APP_ORIGIN || "http://localhost:3000";
}

/**
 * Creates and emails a verification link; a quiet no-op without SMTP.
 *
 * Deliberately NOT in a "use server" module. It used to be exported from one,
 * which made it a callable endpoint: no session, no rate limit, any user id,
 * any address — an open relay for "Verify your Mbarete email" through our
 * own SMTP account, and an unbounded token insert. Only server code reaches
 * it now: signup, and the session-guarded resend action.
 */
export async function sendVerificationEmail(
  userId: number,
  email: string,
  locale: string,
): Promise<void> {
  if (!isMailConfigured()) return;
  const token = newInviteToken();
  await db.insert(authTokens).values({
    userId,
    kind: "verify",
    tokenHash: hashInviteToken(token),
    expiresAt: isoIn(VERIFY_TTL_MS),
  });
  const link = `${appOrigin()}/${locale}/verify/${token}`;
  const subject = locale === "zh" ? "验证您的 Mbarete 邮箱" : "Verify your Mbarete email";
  const text =
    locale === "zh"
      ? `点击以下链接验证此邮箱（7 天内有效）：\n${link}`
      : `Click the link below to verify this email address (valid for 7 days):\n${link}`;
  await sendMail({ to: email, subject, text }).catch((err) =>
    recordError("mail:verification", err),
  );
}
