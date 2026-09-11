# Compliance posture

What the system does for data-protection compliance (PIPL first, LGPD/GDPR
by analogy), where the boundaries are enforced, and what is deliberately
deferred. Written for the operator and for whoever audits us; kept honest —
if it is not listed here, it is not built.

**Current public flow (11 September 2026):** the website offers Mbarete's
sourcing/export service. Public company signup is permanently closed, including
on legacy SaaS deployments. `/privacy` and `/terms` now contain v2 service notices
in EN/PT/ES/ZH; their source is `src/lib/public-policies.ts`. They describe the
implemented enquiry flow and do not establish a software subscription contract.
They are not a jurisdiction-specific legal compliance certification.

## Data classification

| Class | Examples | Handling |
|---|---|---|
| Credentials | password hashes, reset/invite tokens | bcrypt / SHA-256 only; never logged, never exported, excluded from backups' user-visible CSVs |
| Personal information | user names/emails; contact persons' names, phones, WeChat, emails | tenant-isolated by RLS; exported only by that tenant's admin; deletions audit-logged |
| Business records | products, orders, payments, expenses, documents | tenant-isolated; **accounting records of completed transactions are retained for the statutory archive period and are NOT deleted on individual request** (会计档案管理办法; PIPL legal-obligation basis) |
| Operational telemetry | activity timestamps, AI usage counts, error log | counts and timings only — the platform panel never shows tenant amounts or content |

## Public enquiries and internal access

- Enquiry collection is described beside the submit button, with a direct
  privacy link and service terms in the footer. Submission requests follow-up;
  it does not accept a project quotation or create an account.
- The required name/email/project brief and optional details/photos are stored
  for operator follow-up. Submission does not call an AI provider. Enquiry
  images are re-encoded, stripped of embedded metadata and served only to the
  authenticated operator. Failed image/DB writes clean up prepared files.
- There is currently no automatic enquiry deletion schedule; v2 states this
  explicitly. `LEGAL_CONTACT_EMAIL`, when configured, supplies a direct contact;
  the enquiry form provides a fallback channel for information requests.
- Staff access is issued by an administrator. Legacy signup codes/referral
  links cannot create companies. Old account creation dates are not evidence
  of acceptance of today's public service notice.
- Hosting location, actual provider arrangements and operational retention
  practices must be assessed for the real deployment; code alone cannot prove
  those details. v2 removes the previous unsupported security guarantees.

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
