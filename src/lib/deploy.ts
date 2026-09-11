/**
 * How this instance is deployed.
 *
 * - "self-hosted" (default): one company, created by the boot seed from
 *   ADMIN_EMAIL / COMPANY_NAME. No public signup — this is the NAS install,
 *   and it must keep behaving exactly as it always has.
 * - "saas": retained for existing installations; the boot seed creates nothing.
 *   Public company signup is retired in BOTH modes; staff invitations remain.
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
