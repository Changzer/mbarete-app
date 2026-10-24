"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FormSection } from "@/components/ui/disclosure";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SupplierPicker, type SupplierOption } from "@/components/catalog/supplier-picker";
import { ContactForm } from "@/components/contacts/contact-form";
import { createContact, type ContactActionResult } from "@/lib/actions/contacts";
import type { CardTranscribeResult } from "@/lib/transcribe-card";
import type { MatchCandidate } from "@/lib/contact-match";

/**
 * Supplier sits directly under the photos on purpose: choosing one — or
 * registering one from a business card — is the one job that needs a person
 * while the transcription reads the board, so the wait costs nothing.
 *
 * The choice is this section's own: nothing else on the form reads it.
 */
export function SupplierSection({
  suppliers,
  defaultSupplierId,
  duplicatedFromId,
  transcribeCard,
}: {
  /** Suppliers to pick from, newest first. */
  suppliers: SupplierOption[];
  defaultSupplierId?: number;
  duplicatedFromId?: number;
  /** Card transcription for the inline new-supplier dialog. */
  transcribeCard?: (formData: FormData) => Promise<CardTranscribeResult>;
}) {
  const t = useTranslations("catalog");
  const common = useTranslations("common");

  // "0" is the no-supplier option: Radix Select items cannot carry an empty value.
  const [supplierId, setSupplierId] = useState(defaultSupplierId ? String(defaultSupplierId) : "0");
  // Suppliers registered from this very form, shown first: at the market the
  // vendor just photographed is the one about to be picked.
  const [createdSuppliers, setCreatedSuppliers] = useState<SupplierOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Deduped by id: a supplier created inline is also delivered by the server
  // re-render that follows the create action, and the same id twice renders
  // as two checked entries with doubled trigger text.
  const allSuppliers = [
    ...createdSuppliers,
    ...suppliers.filter((s) => !createdSuppliers.some((c) => c.id === s.id)),
  ];

  /** Wraps createContact so the new supplier lands in the picker, selected. */
  async function createSupplierInline(
    prevState: ContactActionResult | undefined,
    formData: FormData,
  ): Promise<ContactActionResult> {
    const result = await createContact(prevState, formData);
    if (!result.error && result.id) {
      const created: SupplierOption = {
        id: result.id,
        companyName: String(formData.get("companyName") ?? ""),
        companyNameZh: String(formData.get("companyNameZh") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        boothLocation: String(formData.get("boothLocation") ?? ""),
      };
      setCreatedSuppliers((prev) => [created, ...prev]);
      setSupplierId(String(created.id));
      setDialogOpen(false);
    }
    return result;
  }

  /** The card matched a vendor already on file: pick them instead of duplicating. */
  function useExistingSupplier(candidate: MatchCandidate) {
    setSupplierId(String(candidate.id));
    setDialogOpen(false);
  }

  return (
    <FormSection kicker={t("supplier")} className="lg:col-span-2">
      <Field label={t("supplier")} htmlFor="supplierId">
        <input
          type="hidden"
          name="supplierId"
          value={supplierId === "0" ? "" : supplierId}
        />
        {duplicatedFromId ? (
          <input type="hidden" name="duplicatedFromId" value={duplicatedFromId} />
        ) : null}
        <div className="flex gap-2">
          <SupplierPicker
            suppliers={allSuppliers}
            value={supplierId}
            onChange={setSupplierId}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(true)}
            data-testid="new-supplier"
          >
            {t("newSupplier")}
          </Button>
        </div>
      </Field>

      {/* Registering the vendor without leaving the product: photograph the
          business card, proofread, save — the new supplier arrives selected.
          The dialog portals out of the DOM, so the forms never nest. */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("newSupplier")}</DialogTitle>
          </DialogHeader>
          <ContactForm
            type="supplier"
            action={createSupplierInline}
            submitLabel={common("save")}
            // Offline, the card is captured to the phone; the product being
            // registered simply stays unlinked and the supplier is attached
            // once both have reached the server.
            offlineCapture
            onSavedOffline={() => setDialogOpen(false)}
            transcribe={transcribeCard}
            candidates={allSuppliers.map((s) => ({
              id: s.id,
              companyName: s.companyName,
              companyNameZh: s.companyNameZh,
              phone: s.phone,
            }))}
            onUseExisting={useExistingSupplier}
          />
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}
