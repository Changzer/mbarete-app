"use client";

import { useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoPicker } from "@/components/catalog/photo-picker";
import { runKimiTest, type KimiTestResult, type KimiStep } from "@/lib/actions/kimi-test";

/**
 * Temporary diagnostic panel — English-only on purpose, so removing the
 * feature later is deleting three files, not weeding translation keys.
 */

function StepResult({ title, step }: { title: string; step: KimiStep }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        step.ok
          ? "border-green-300 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200"
          : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      }`}
    >
      <p className="font-medium">
        {step.ok ? "✓" : "✗"} {title} · {(step.ms / 1000).toFixed(1)}s
      </p>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
        {step.detail}
      </pre>
    </div>
  );
}

export function KimiTestPanel() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<KimiTestResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    const input = formRef.current?.elements.namedItem("images");
    const files = input instanceof HTMLInputElement ? Array.from(input.files ?? []) : [];

    setPending(true);
    setFailed(false);
    setResult(null);
    try {
      const data = new FormData();
      for (const file of files) data.append("images", file);
      setResult(await runKimiTest(data));
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Step 1 checks that this server can reach the Moonshot API and that the key is accepted
        (and lists the available model names). Add a market photo — product plus its handwritten
        price board — to also run step 2, a real extraction, and judge the reading quality
        yourself.
      </p>

      <PhotoPicker />

      <Button type="button" disabled={pending} onClick={run} className="min-h-11 gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        {pending ? "Testing…" : "Run test"}
      </Button>

      {failed ? (
        <p className="text-sm text-red-600">The test request itself failed. Try again.</p>
      ) : null}

      {result && !result.ok ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          MOONSHOT_API_KEY is not set on the server. Add it to the .env file and restart the app.
        </p>
      ) : null}

      {result?.ok ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Endpoint: {result.baseUrl} · Model: {result.model} · Thinking:{" "}
            {result.instant ? "disabled (instant)" : "default"}
          </p>
          <StepResult title="Connection & key" step={result.keyCheck} />
          {result.extraction ? (
            <StepResult title="Photo extraction" step={result.extraction} />
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              No photo attached — extraction step skipped.
            </p>
          )}
        </div>
      ) : null}
    </form>
  );
}
