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
import { ContactForm } from "@/components/contacts/contact-form";
import { createContact, updateContact, deleteContact } from "@/lib/actions/contacts";

type Contact = {
  id: number;
  type: "supplier" | "client";
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  whatsapp: string;
  wechat: string;
  notes: string;
};

export function ContactManager({
  type,
  contacts,
}: {
  type: "supplier" | "client";
  contacts: Contact[];
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? t("edit") : addLabel}</DialogTitle>
            </DialogHeader>
            <ContactForm
              type={type}
              action={editing ? updateContact.bind(null, editing.id) : createContact}
              defaultValues={editing ?? undefined}
              submitLabel={common("save")}
              onSuccess={() => setDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {contacts.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("noContacts")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 text-left text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-4 py-2 font-medium">{t("companyName")}</th>
                <th className="px-4 py-2 font-medium">{t("contactPerson")}</th>
                <th className="px-4 py-2 font-medium">{t("phone")}</th>
                <th className="px-4 py-2 font-medium">{t("email")}</th>
                <th className="px-4 py-2 font-medium">{t("whatsapp")}</th>
                <th className="px-4 py-2 font-medium">{t("wechat")}</th>
                <th className="px-4 py-2 font-medium">{common("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">{c.companyName}</td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{c.contactPerson}</td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{c.phone}</td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{c.email}</td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{c.whatsapp}</td>
                  <td className="px-4 py-2 text-neutral-700 dark:text-neutral-300">{c.wechat}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                        {common("edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (confirm(t("deleteConfirm"))) {
                            const error = await deleteContact(c.id);
                            if (error) alert(t("deleteHasOrders"));
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
