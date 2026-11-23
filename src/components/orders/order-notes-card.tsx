"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { updateOrderNotes } from "@/lib/actions/orders";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OrderSection } from "@/components/orders/order-section";

/**
 * The notes that print on the proforma, editable right on the order —
 * on any status, because they are the document's wording, not its terms.
 */
export function OrderNotesCard({ orderId, notes }: { orderId: number; notes: string }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [value, setValue] = useState(notes);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== notes.trim();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateOrderNotes(orderId, value);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <OrderSection
      title={t("notesTitle")}
      description={t("notesHelp")}
      className="mt-4"
      data-testid="order-notes"
    >
      <Textarea
        id="order-notes"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder={t("notesPlaceholder")}
        rows={4}
        maxLength={2000}
        data-testid="order-notes-input"
      />
      <div className="mt-2 flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending || !dirty} data-testid="order-notes-save">
          {t("notesSave")}
        </Button>
        {saved && !dirty ? (
          <span role="status" className="text-[12px] text-ok" data-testid="order-notes-saved">
            {t("notesSaved")}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-[12px] text-danger">
            {t("notesFailed")}
          </span>
        ) : null}
      </div>
    </OrderSection>
  );
}
