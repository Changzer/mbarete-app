import { KimiTestPanel } from "@/components/kimi-test/kimi-test-panel";

/**
 * Temporary page (not linked from the nav): evaluates Moonshot/Kimi as a
 * possible transcription backend from the server's own network position.
 * Reached directly at /kimi-test. Remove with the panel and action once the
 * Kimi-vs-Anthropic decision is made.
 */
export default function KimiTestPage() {
  const configured = Boolean(process.env.MOONSHOT_API_KEY);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
        Kimi API test
      </h1>
      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Temporary diagnostic — nothing here touches the catalog or the existing AI features.
      </p>

      {configured ? (
        <KimiTestPanel />
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">MOONSHOT_API_KEY is not set.</p>
          <p className="mt-1">
            Add it to the app&apos;s .env file (optionally MOONSHOT_BASE_URL and MOONSHOT_MODEL),
            restart with <code>docker compose up -d</code>, and reload this page.
          </p>
        </div>
      )}
    </div>
  );
}
