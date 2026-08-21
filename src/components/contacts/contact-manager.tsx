"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ContactForm, type ExistingCardImage } from "@/components/contacts/contact-form";
import { createContact, updateContact, deleteContact } from "@/lib/actions/contacts";
import type { CardTranscribeResult } from "@/lib/transcribe-card";
import { setSupplierActive } from "@/lib/actions/offers";
import { Badge } from "@/components/ui/badge";

type Contact = {
  id: number;
  type: "supplier" | "client";
  companyName: string;
  companyNameZh: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  boothLocation: string;
  bankInfo: string;
  notes: string;
  images: ExistingCardImage[];
  active: boolean;
};

export function ContactManager({
  type,
  contacts,
  transcribe,
}: {
  type: "supplier" | "client";
  contacts: Contact[];
  transcribe?: (formData: FormData) => Promise<CardTranscribeResult>;
}) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const addLabel = type === "supplier" ? t("addSupplier") : t("addClient");

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}>
              {addLabel}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? t("edit") : addLabel}</DialogTitle>
            </DialogHeader>
            <ContactForm
              type={type}
              action={editing ? updateContact.bind(null, editing.id) : createContact}
              defaultValues={editing ?? undefined}
              existingImages={editing?.images ?? []}
              submitLabel={common("save")}
              onSuccess={() => setDialogOpen(false)}
              // Only when creating: a delivered offline edit could land on
              // top of someone else's newer changes.
              offlineCapture={!editing}
              onSavedOffline={() => setDialogOpen(false)}
              transcribe={transcribe}
              // Warn about likely duplicates, but not against the row being edited.
              candidates={contacts.filter((c) => c.id !== editing?.id)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-sub">{t("noContacts")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-sub">
              <tr>
                <th className="px-4 py-2 font-medium">{t("companyName")}</th>
                <th className="px-4 py-2 font-medium">{t("contactPerson")}</th>
                <th className="px-4 py-2 font-medium">{t("phone")}</th>
                <th className="px-4 py-2 font-medium">{t("wechat")}</th>
                {type === "supplier" ? (
                  <th className="px-4 py-2 font-medium">{t("boothLocation")}</th>
                ) : (
                  <th className="px-4 py-2 font-medium">{t("email")}</th>
                )}
                <th className="px-4 py-2 font-medium">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-medium text-ink">
                    {c.companyName}
                    {c.companyNameZh ? (
                      <span className="ml-1 font-normal text-sub">
                        {c.companyNameZh}
                      </span>
                    ) : null}
                    {!c.active ? (
                      <Badge variant="secondary" className="ml-2">
                        {t("inactive")}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-ink">{c.contactPerson}</td>
                  <td className="px-4 py-2 text-ink">{c.phone}</td>
                  <td className="px-4 py-2 text-ink">
                    <WechatCell contact={c} scanHint={t("wechatQrHelp")} />
                  </td>
                  <td className="px-4 py-2 text-ink">
                    {type === "supplier" ? c.boothLocation : c.email}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        {common("edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSupplierActive(c.id, !c.active)}
                      >
                        {c.active ? t("deactivate") : t("reactivate")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (confirm(t("deleteConfirm"))) {
                            const error = await deleteContact(c.id);
                            if (error === "has-products") alert(t("deleteHasProducts"));
                            else if (error) alert(t("deleteHasOrders"));
                          }
                        }}
                      >
                        {common("delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The WeChat column: the QR cropped from the vendor's card when there is one,
 * the printed id when the card gave one, or nothing. The QR is the contact
 * method itself — tapping opens it full size, which is what gets scanned.
 */
function WechatCell({ contact, scanHint }: { contact: Contact; scanHint: string }) {
  const qr = contact.images.find((img) => img.kind === "qr");
  if (!qr) return <>{contact.wechat}</>;
  return (
    <div className="flex flex-col items-start gap-1">
      <a href={qr.path} target="_blank" rel="noreferrer" title={scanHint}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr.path}
          alt="WeChat QR"
          className="h-16 w-16 rounded border border-line bg-surface object-contain"
          data-testid="wechat-qr-cell"
        />
      </a>
      {contact.wechat ? <span>{contact.wechat}</span> : null}
    </div>
  );
}
