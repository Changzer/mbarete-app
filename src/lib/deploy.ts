/**
 * How this instance is deployed.
 *
 * - "self-hosted" (default): one company, created by the boot seed from
 *   ADMIN_EMAIL / COMPANY_NAME. No public signup — this is the NAS install,
 *   and it must keep behaving exactly as it always has.
 * - "saas": companies are created by the public /signup flow instead; the boot
 *   seed creates nothing. Signup is gated by SIGNUP_CODE.
 *
 * `||` not `??`: docker-compose passes unset vars through as empty strings.
 */
export type DeployMode = "self-hosted" | "saas";

export function deployMode(): DeployMode {
  return (process.env.DEPLOY_MODE || "self-hosted") === "saas" ? "saas" : "self-hosted";
}

export function isSaas(): boolean {
  return deployMode() === "saas";
}

/**
 * The code a person must present to create a company on a public deployment.
 * Empty means "no code set" — and in SaaS mode that deliberately closes signup
 * rather than opening it, so a misconfigured public server can't be farmed for
 * free companies. Self-hosted never reaches this check.
 */
export function signupCode(): string {
  return process.env.SIGNUP_CODE || "";
}
