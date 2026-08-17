import { getTranslations } from "next-intl/server";
import { getContactsByType } from "@/lib/queries/contacts";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ContactManager } from "@/components/contacts/contact-manager";

export default async function ContactsPage() {
  const t = await getTranslations("contacts");
  const [suppliers, clients] = await Promise.all([
    getContactsByType("supplier"),
    getContactsByType("client"),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">{t("title")}</h1>

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">{t("suppliers")}</TabsTrigger>
          <TabsTrigger value="clients">{t("clients")}</TabsTrigger>
        </TabsList>
        <TabsContent value="suppliers">
          <ContactManager type="supplier" contacts={suppliers} />
        </TabsContent>
        <TabsContent value="clients">
          <ContactManager type="client" contacts={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
