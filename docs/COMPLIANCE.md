# Compliance posture

What the system does for data-protection compliance (PIPL first, LGPD/GDPR
by analogy), where the boundaries are enforced, and what is deliberately
deferred. Written for the operator and for whoever audits us; kept honest —
if it is not listed here, it is not built.

**Counsel caveat: the privacy policy and terms of service shipped at
`/privacy` and `/terms` are v1 templates drafted against the code, not
against statute by a lawyer. Before public signup or any regulatory filing,
have qualified PRC counsel review both.**

## Data classification

| Class | Examples | Handling |
|---|---|---|
| Credentials | password hashes, reset/invite tokens | bcrypt / SHA-256 only; never logged, never exported, excluded from backups' user-visible CSVs |
| Personal information | user names/emails; contact persons' names, phones, WeChat, emails | tenant-isolated by RLS; exported only by that tenant's admin; deletions audit-logged |
| Business records | products, orders, payments, expenses, documents | tenant-isolated; **accounting records of completed transactions are retained for the statutory archive period and are NOT deleted on individual request** (会计档案管理办法; PIPL legal-obligation basis) |
| Operational telemetry | activity timestamps, AI usage counts, error log | counts and timings only — the platform panel never shows tenant amounts or content |

## Consent

- Signup requires an explicit checkbox agreeing to `/terms` and `/privacy`.
  The checkbox is **server-enforced** (`consent: z.literal("on")` in the
  signup action): no account can exist without it. An account's creation
  date therefore evidences consent to the policy version current that day.
- Policy versions are dated on the pages themselves (v1 · 2026-08-28). A
  future material change bumps the version and should re-prompt — not yet
  built; tracked for the public-signup batch.

## AI processing

- Photo transcription is user-initiated, labelled in the UI ("AI 提取，请核对
  / AI-read — please verify"), and its output lands in an editable form —
  never directly into a commercial document.
- `DEPLOY_REGION=cn` makes the boot **refuse** any Anthropic configuration;
  the vision layer independently never selects Anthropic in that region.
  Mainland deployments serve Moonshot (Beijing Moonshot Technology Co.,
  Ltd.), a domestically filed model.
- Per-company usage is metered in `ai_usage` (provider, model, images,
  tokens) — the record a 大模型 usage inquiry would ask for.

## Sub-processors

Disclosed in the privacy policy §4: Moonshot AI (vision, mainland),
Anthropic PBC (vision, non-mainland deployments), Tencent Exmail (email),
the hosting cloud provider, open.er-api.com (public exchange rates only —
no personal data leaves for it).

## Data subject rights — current state

| Right | State |
|---|---|
| Access / correction | ✅ in-product (tenant users edit their records) |
| Company-level export | ✅ Settings → full CSV+files backup; stays available while suspended |
| Deletion | ✅ per-record with audit log; accounting-record carve-out applies |
| Person-level export (one contact's data across the tenant) | ❌ deferred to the public-signup batch |
| Purge of non-transactional PII (drafts, card scans, unattached contacts) | ❌ deferred to the public-signup batch |

## Deferred, deliberately (build before the corresponding milestone)

- Person-level export + narrowed purge — before public signup.
- Consent re-prompt on policy version change — before public signup.
- SMS real-name verification — at mainland public launch.
- ICP / 公安 filings themselves (the footer slots exist: `ICP_BEIAN`,
  `GONGAN_BEIAN`) — at mainland deployment; filing requires the mainland
  host and domain.
- 大模型 filing questions for the serving model — at mainland launch,
  with counsel.

## Incident response

See `docs/INCIDENT-RESPONSE.md` — detection, containment, assessment,
notification duties and recovery, with the concrete commands for this
system.
