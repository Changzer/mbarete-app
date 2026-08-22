import nodemailer, { type Transporter } from "nodemailer";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * Outbound email, deliberately generic SMTP.
 *
 * Works against any provider — the expected one is Tencent Exmail / WeCom
 * mail (smtp.exmail.qq.com:465, username = the mailbox, password = the
 * client authorization code generated in the mailbox settings, NOT the
 * login password). Moving to Tencent Cloud SES later is an env change.
 *
 *   SMTP_HOST=smtp.exmail.qq.com
 *   SMTP_PORT=465
 *   SMTP_USER=contacts@example.cn
 *   SMTP_PASS=<client authorization code>
 *   SMTP_FROM="Mbarete <contacts@example.cn>"
 *
 * With no SMTP configured, email features announce themselves as
 * unavailable instead of half-working. MAIL_DEBUG_DIR (dev/testing) writes
 * each message to a .eml file instead of sending — flows can be exercised
 * end to end with no mailbox at all.
 */

export function isMailConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.MAIL_DEBUG_DIR,
  );
}

function fromAddress(): string {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@localhost";
}

let cached: Transporter | null = null;

function transporter(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    // Exmail and most Chinese providers speak implicit TLS on 465.
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const debugDir = process.env.MAIL_DEBUG_DIR;
  if (debugDir) {
    const name = `${Date.now()}-${input.to.replace(/[^a-z0-9@.]/gi, "_")}.eml`;
    await fs.mkdir(debugDir, { recursive: true });
    await fs.writeFile(
      path.join(debugDir, name),
      [`From: ${fromAddress()}`, `To: ${input.to}`, `Subject: ${input.subject}`, "", input.text].join(
        "\n",
      ),
    );
    return;
  }
  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
}
