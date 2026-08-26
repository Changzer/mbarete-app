import { requirePlatformAdmin } from "@/lib/authz";
import { loadPlatformOverview, type CompanyMetrics } from "@/lib/platform/metrics";
import { ModuleToggle } from "./module-toggle";
import { PlanSelect } from "./plan-select";
import { BackupNow } from "./backup-now";
import { backupStatus, type BackupStatus } from "@/lib/backups";
import { SeatStepper } from "./seat-stepper";
import { UnlockPanel } from "./unlock-panel";
import { platformReauth } from "@/lib/platform/reauth";
import { recentErrors, type ErrorEntry } from "@/lib/monitoring";
import { planOf, seatLimit, usageLabel } from "@/lib/plans";

/**
 * The operator's chair: every company on the platform, what they use, and
 * whether they are still alive — counts and timestamps only, never amounts.
 * Everyone without users.platform_admin gets a 404 from requirePlatformAdmin,
 * so this URL does not exist for tenants.
 */

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

function parseUtc(ts: string): number {
  return Date.parse(ts.replace(" ", "T") + "Z");
}

function ago(ts: string | null): string {
  if (!ts) return "never";
  const days = Math.floor((Date.now() - parseUtc(ts)) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function hours(seconds: number): string {
  if (seconds < 60) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return n > 0 ? `${n} B` : "—";
}

/** Churn signal: quiet for two weeks reads amber, never-seen reads grey. */
function ActivityChip({ idleDays }: { idleDays: number | null }) {
  if (idleDays === null) {
    return <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-faint">never seen</span>;
  }
  if (idleDays >= 14) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
        idle {idleDays}d
      </span>
    );
  }
  return null;
}

/** The clock, behind a name: a server page renders once per request, and
 * the compiler's purity rule only trusts what it cannot see into. */
function nowMs(): number {
  return Date.now();
}

/** Whole days since the company was last seen; null when it never was. */
function idleDaysOf(m: CompanyMetrics, now: number): number | null {
  if (!m.lastSeenAt) return null;
  return Math.floor((now - parseUtc(m.lastSeenAt)) / DAY_MS);
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface p-4">
      <div className="text-[28px] font-extrabold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-sub">{label}</div>
    </div>
  );
}

/** Where the disaster copy stands, always in view of the operator's chair. */
function BackupLine({ status, now }: { status: BackupStatus; now: number }) {
  if (!status.configured) {
    return (
      <span className="text-[11px] text-faint" data-testid="backup-status">
        Backups off — set BACKUP_DIR
      </span>
    );
  }
  const ageH = status.newestMs === null ? null : Math.floor((now - status.newestMs) / 3_600_000);
  const stale = ageH === null || ageH >= 26;
  const text =
    status.newestMs === null
      ? "no backups yet"
      : `${status.count} kept · last ${ageH === 0 ? "under an hour" : `${ageH}h`} ago`;
  return (
    <span
      className={`text-[11px] ${stale ? "font-medium text-amber-700" : "text-sub"}`}
      data-testid="backup-status"
    >
      Backups: {text}
      {status.lastError ? ` · last run failed: ${status.lastError}` : ""}
      {stale ? " · STALE" : ""}
    </span>
  );
}

/**
 * Server errors from the last 24 hours — in-memory, so what the operator
 * sees is this process since its last restart; a restart wiping the list
 * is itself reported by the heartbeat monitor.
 */
function ErrorsLine({ errors }: { errors: ErrorEntry[] }) {
  if (errors.length === 0) {
    return (
      <span className="text-[11px] text-sub" data-testid="errors-status">
        No server errors in 24h
      </span>
    );
  }
  const total = errors.reduce((a, e) => a + e.count, 0);
  const latest = errors[0];
  return (
    <span
      className="max-w-[420px] truncate text-[11px] font-medium text-amber-700"
      data-testid="errors-status"
      title={errors
        .slice(0, 5)
        .map((e) => `${e.count}× ${e.source}: ${e.message}`)
        .join("\n")}
    >
      {total} server error{total > 1 ? "s" : ""} in 24h · latest: {latest.message.slice(0, 80)}
    </span>
  );
}

export default async function PlatformAdminPage() {
  const operator = await requirePlatformAdmin();
  const { companies, totals } = await loadPlatformOverview();
  const backups = await backupStatus();
  const errors = recentErrors();
  const now = nowMs();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[23px] font-extrabold tracking-tight text-ink">Mbarete Platform</h1>
          <p className="text-sm text-sub">
            Signed in as {operator.email}. Counts and activity only — tenant money is never shown here.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <UnlockPanel unlocked={platformReauth.isFresh(operator.id)} />
          <ErrorsLine errors={errors} />
          <BackupLine status={backups} now={now} />
          {backups.configured ? <BackupNow /> : null}
        </div>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="platform-tiles">
        <Tile label="Companies" value={totals.companies} />
        <Tile label="Users" value={totals.usersTotal} />
        <Tile label="Active last 7 days" value={totals.activeLast7d} />
        <Tile label="New last 30 days" value={totals.newLast30d} />
        <Tile label="Referred" value={totals.referred} />
      </div>

      <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
        <table className="w-full text-sm" data-testid="companies-table">
          <thead className="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-sub">
            <tr>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 text-right font-medium">Users</th>
              <th className="px-3 py-2 text-right font-medium">Products</th>
              <th className="px-3 py-2 text-right font-medium">Suppliers</th>
              <th className="px-3 py-2 text-right font-medium">Clients</th>
              <th className="px-3 py-2 text-right font-medium">Draft</th>
              <th className="px-3 py-2 text-right font-medium">Confirmed</th>
              <th className="px-3 py-2 text-right font-medium">Shipped</th>
              <th className="px-3 py-2 text-right font-medium">Days active</th>
              <th className="px-3 py-2 text-right font-medium">Time in app</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2 text-right font-medium">Storage</th>
              <th className="px-3 py-2 text-center font-medium">Plan</th>
              <th className="px-3 py-2 text-center font-medium">Seats</th>
              <th className="px-3 py-2 text-center font-medium">Orders</th>
              <th className="px-3 py-2 text-center font-medium">Finance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {companies.map((m) => (
              <tr key={m.id} data-testid={`company-row-${m.id}`}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{m.name}</span>
                    <span className="text-[11px] text-faint">#{m.id}</span>
                    <ActivityChip idleDays={idleDaysOf(m, now)} />
                  </div>
                  <div className="text-[11px] text-faint">
                    since {m.createdAt.slice(0, 10)}
                    {m.referredByName ? ` · referred by ${m.referredByName}` : ""}
                    {m.referrals > 0 ? ` · ${m.referrals} referral${m.referrals > 1 ? "s" : ""}` : ""}
                    {m.pendingInvites > 0 ? ` · ${m.pendingInvites} invite${m.pendingInvites > 1 ? "s" : ""} pending` : ""}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {usageLabel(m.users, seatLimit(planOf(m.plan), m.extraSeats))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {usageLabel(m.products, planOf(m.plan).maxProducts)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.suppliers}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.clients}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.ordersDraft}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.ordersConfirmed}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.ordersShipped}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{m.daysActive}</td>
                <td className="px-3 py-2 text-right tabular-nums text-sub">{hours(m.activeSeconds)}</td>
                <td className="px-3 py-2 text-sub">{ago(m.lastSeenAt)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-sub">{bytes(m.storageBytes)}</td>
                <td className="px-3 py-2 text-center">
                  <PlanSelect companyId={m.id} plan={m.plan} />
                </td>
                <td className="px-3 py-2 text-center">
                  <SeatStepper companyId={m.id} extraSeats={m.extraSeats} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ModuleToggle companyId={m.id} module="orders" enabled={m.moduleOrders} />
                </td>
                <td className="px-3 py-2 text-center">
                  <ModuleToggle companyId={m.id} module="finance" enabled={m.moduleFinance} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-faint">
        Catalog and Contacts are core and always on. Switching a module off makes its pages,
        actions and nav entries stop existing for that company — their data stays untouched
        and returns the moment the switch comes back. Picking a plan applies its module
        defaults and its limits (users, products, storage); the switches stay individually
        overridable after. Seats adds paid seats on top of the plan&apos;s cap (billing is
        manual for now — collect first, then click plus); extras stack on any plan and
        survive plan changes.
      </p>
    </div>
  );
}
