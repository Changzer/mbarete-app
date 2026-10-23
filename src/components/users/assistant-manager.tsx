"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  createAssistant,
  issueAssistantKey,
  setAssistantScopes,
  switchOffAssistant,
  type AssistantActionResult,
} from "@/lib/actions/assistants";
import type { AssistantRow } from "@/lib/queries/assistants";
import { ASSISTANT_SCOPES, type AssistantScope } from "@/lib/assistant-keys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Chat assistants (OpenClaw and the like) working on the company's behalf
 * with a key. A key is shown exactly once, right after it is made; what an
 * assistant may do beyond reading is three ticks the admin can change at any
 * time, and switching it off takes effect on its next request.
 */
export function AssistantManager({ assistants }: { assistants: AssistantRow[] }) {
  const t = useTranslations("assistants");
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function errorOf(res: AssistantActionResult) {
    if (!res.error) return null;
    return res.error === "limit" ? t("errorLimit") : t("errorInvalid");
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4" data-testid="assistants">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-ink">{t("title")}</span>
          <span className="text-xs text-sub">{t("help")}</span>
        </div>

        {fresh ? <FreshKey name={fresh.name} value={fresh.key} onDone={() => setFresh(null)} /> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {assistants.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {assistants.map((a) => (
              <AssistantItem
                key={a.id}
                assistant={a}
                onKey={(key) => {
                  setError(null);
                  setFresh({ name: a.name, key });
                }}
                onError={setError}
                errorOf={errorOf}
              />
            ))}
          </ul>
        ) : null}

        {adding ? (
          <AddAssistant
            onCancel={() => setAdding(false)}
            onCreated={(name, key) => {
              setAdding(false);
              setError(null);
              setFresh({ name, key });
            }}
            errorOf={errorOf}
          />
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="assistant-add">
              {t("add")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScopeChoices({ value, onChange, idPrefix }: { value: Set<AssistantScope>; onChange: (next: Set<AssistantScope>) => void; idPrefix: string }) {
  const t = useTranslations("assistants");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs text-sub">{t("alwaysAllowed")}</legend>
      {ASSISTANT_SCOPES.map((scope) => (
        <label key={scope} htmlFor={`${idPrefix}-${scope}`} className="flex items-start gap-2 text-sm">
          <input
            id={`${idPrefix}-${scope}`}
            type="checkbox"
            className="mt-1"
            checked={value.has(scope)}
            data-testid={`${idPrefix}-${scope}`}
            onChange={(e) => {
              const next = new Set(value);
              if (e.target.checked) next.add(scope);
              else next.delete(scope);
              onChange(next);
            }}
          />
          <span className="flex flex-col">
            <span className="text-ink">{t(`scope_${scope}`)}</span>
            <span className="text-xs text-sub">{t(`scopeHelp_${scope}`)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function AddAssistant({
  onCancel,
  onCreated,
  errorOf,
}: {
  onCancel: () => void;
  onCreated: (name: string, key: string) => void;
  errorOf: (res: AssistantActionResult) => string | null;
}) {
  const t = useTranslations("assistants");
  const [name, setName] = useState("OpenClaw");
  const [scopes, setScopes] = useState<Set<AssistantScope>>(new Set(["followup"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await createAssistant(name, [...scopes]);
      if (res.key) onCreated(name.trim(), res.key);
      else setError(errorOf(res));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assistant-name">{t("name")}</Label>
        <Input id="assistant-name" className="w-56" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </div>
      <ScopeChoices value={scopes} onChange={setScopes} idPrefix="assistant-new" />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={submit} data-testid="assistant-create">
          {t("create")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

function FreshKey({ name, value, onDone }: { name: string; value: string; onDone: () => void }) {
  const t = useTranslations("assistants");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3" data-testid="assistant-fresh-key">
      <p className="text-sm font-medium text-ink">{t("freshTitle", { name })}</p>
      <p className="text-xs text-sub">{t("freshHelp")}</p>
      <code className="break-all text-xs text-ink" data-testid="assistant-key">
        {value}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              // Clipboard blocked (plain http): the key is selectable above.
            }
          }}
        >
          {copied ? t("copied") : t("copy")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("done")}
        </Button>
      </div>
      <ol className="ml-4 list-decimal text-xs text-sub">
        <li>
          {t("setupSkill")}{" "}
          <a className="font-semibold text-action-chrome underline" href="/api/assistant/skill" download="SKILL.md" data-testid="assistant-skill-link">
            {t("setupSkillLink")}
          </a>
        </li>
        <li>{t("setupKey")}</li>
        <li>{t("setupTry")}</li>
      </ol>
    </div>
  );
}

function AssistantItem({
  assistant: a,
  onKey,
  onError,
  errorOf,
}: {
  assistant: AssistantRow;
  onKey: (key: string) => void;
  onError: (message: string | null) => void;
  errorOf: (res: AssistantActionResult) => string | null;
}) {
  const t = useTranslations("assistants");
  const [editing, setEditing] = useState(false);
  const [scopes, setScopes] = useState<Set<AssistantScope>>(new Set(a.scopes));
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<AssistantActionResult>) {
    setBusy(true);
    onError(null);
    try {
      const res = await action();
      if (res.key) onKey(res.key);
      else if (res.error) onError(errorOf(res));
      return res;
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line px-3 py-2 text-sm" data-testid={`assistant-${a.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{a.name}</span>
          <Badge variant={a.active ? "success" : "outline"}>{a.active ? t("on") : t("off")}</Badge>
          {a.scopes.length === 0 ? <span className="text-xs text-sub">{t("readOnly")}</span> : null}
          {a.scopes.map((s) => (
            <Badge key={s} variant="outline">
              {t(`scope_${s}`)}
            </Badge>
          ))}
        </span>
        <span className="text-xs text-sub">
          {a.lastUsedAt ? t("lastUsed", { when: a.lastUsedAt.slice(0, 16) }) : t("neverUsed")}
        </span>
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <ScopeChoices value={scopes} onChange={setScopes} idPrefix={`assistant-${a.id}-scope`} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              data-testid={`assistant-${a.id}-save`}
              onClick={async () => {
                const res = await run(() => setAssistantScopes(a.id, [...scopes]));
                if (!res.error) setEditing(false);
              }}
            >
              {t("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {a.active ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)} data-testid={`assistant-${a.id}-edit`}>
                {t("permissions")}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => issueAssistantKey(a.id))} data-testid={`assistant-${a.id}-newkey`}>
                {t("newKey")}
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => switchOffAssistant(a.id))} data-testid={`assistant-${a.id}-off`}>
                {t("switchOff")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => issueAssistantKey(a.id))} data-testid={`assistant-${a.id}-on`}>
              {t("switchOn")}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
