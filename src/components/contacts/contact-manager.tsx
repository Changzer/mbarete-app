"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useIsAdmin } from "@/components/role-provider";
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

  const isAdmin = useIsAdmin();

  /** One delete path, shared by the phone list and the desktop table. */
  async function removeContact(id: number) {
    if (!confirm(t("deleteConfirm"))) return;
    const error = await deleteContact(id);
    if (error === "has-products") alert(t("deleteHasProducts"));
    else if (error) alert(t("deleteHasOrders"));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] text-sub">
          {t(type === "supplier" ? "countSuppliers" : "countClients", { count: contacts.length })}
        </span>
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
        <p className="text-[12.5px] text-sub">{t("noContacts")}</p>
      ) : (
        <>
          {/*
            On a phone this is a list, not a table with six columns scrolling
            sideways. Booth leads, because a supplier record is looked up to
            answer one question: which aisle, which floor, which shop.
          */}
          <ul className="flex flex-col gap-2 lg:hidden" data-testid="contact-rows">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">
                      {c.companyName}
                      {c.companyNameZh ? (
                        <span className="ml-1.5 font-medium text-sub">{c.companyNameZh}</span>
                      ) : null}
                    </p>
                    {/* A retired booth still holds quotes and past orders, so
                        it stays in the list — labelled, not hidden. */}
                    {!c.active ? (
                      <Badge variant="secondary" className="mt-1">
                        {t("inactive")}
                      </Badge>
                    ) : null}
                    {type === "supplier" && c.boothLocation ? (
                      <p className="mt-1 inline-flex rounded-full bg-action-soft px-2 py-0.5 font-mono text-[12px] font-semibold text-action-chrome">
                        {c.boothLocation}
                      </p>
                    ) : null}
                    {c.contactPerson ? (
                      <p className="mt-1 truncate text-[12px] text-sub">{c.contactPerson}</p>
                    ) : null}
                    <p className="mt-0.5 truncate font-mono text-[12px] text-sub">
                      {[c.phone, type === "supplier" ? "" : c.email].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <WechatCell contact={c} scanHint={t("wechatQrHelp")} />
                </div>
                <div className="flex gap-2 border-t border-line pt-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(c)}>
                    {common("edit")}
                  </Button>
                  {type === "supplier" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSupplierActive(c.id, !c.active)}
                    >
                      {c.active ? t("deactivate") : t("reactivate")}
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Button variant="ghost" size="sm" onClick={() => removeContact(c.id)}>
                      {common("delete")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {/*
            Fixed column widths, like the catalog table: real supplier rows
            carry six phone numbers and a full bilingual street address, and
            an auto-layout table hands the widest cell all the width — the
            name and address collapse into one-word slivers and the rest
            scrolls sideways. Company flexes; everything else is bounded.
          */}
          <div className="hidden overflow-x-auto rounded-[12px] border border-line bg-surface lg:block">
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-line bg-surface-2 text-left text-sub">
              <tr>
                <th className="px-4 py-2 font-medium">{t("companyName")}</th>
                <th className="w-36 px-4 py-2 font-medium">{t("contactPerson")}</th>
                <th className="w-40 px-4 py-2 font-medium">{t("phone")}</th>
                <th className="w-24 px-4 py-2 font-medium">{t("wechat")}</th>
                {type === "supplier" ? (
                  <th className="w-56 px-4 py-2 font-medium">{t("boothLocation")}</th>
                ) : (
                  <th className="w-56 px-4 py-2 font-medium">{t("email")}</th>
                )}
                <th className="w-44 px-4 py-2 font-medium">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 align-top font-medium text-ink">
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
                  <td className="px-4 py-2 align-top text-ink">{c.contactPerson}</td>
                  {/* One number per line: vendors list every colleague's phone
                      in one field, and a stack reads while a wrapped blob or a
                      nowrap mile-long line does not. */}
                  <td className="px-4 py-2 align-top font-mono text-[12.5px] text-ink">
                    {c.phone
                      .split(/[/,;]+/)
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .map((p, i) => (
                        <span key={i} className="block truncate">
                          {p}
                        </span>
                      ))}
                  </td>
                  <td className="px-4 py-2 align-top text-ink">
                    <WechatCell contact={c} scanHint={t("wechatQrHelp")} />
                  </td>
                  <td className="break-words px-4 py-2 align-top text-[12.5px] leading-snug text-ink">
                    {type === "supplier" ? c.boothLocation : c.email}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                        {common("edit")}
                      </Button>
                      {/* Suppliers only, same as the phone list: retiring a
                          booth is a supplier concept. */}
                      {type === "supplier" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSupplierActive(c.id, !c.active)}
                        >
                          {c.active ? t("deactivate") : t("reactivate")}
                        </Button>
                      ) : null}
                      {isAdmin ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-danger"
                          onClick={() => removeContact(c.id)}
                        >
                          {common("delete")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
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
  // Bounded: a WeChat id is arbitrary text and will happily push a phone
  // list's booth line off the screen given the chance.
  if (!qr)
    return (
      <span className="block max-w-28 truncate font-mono text-[12px] text-sub">
        {contact.wechat}
      </span>
    );
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
      {contact.wechat ? (
        <span className="max-w-24 truncate font-mono text-[12px] text-sub">{contact.wechat}</span>
      ) : null}
    </div>
  );
}
