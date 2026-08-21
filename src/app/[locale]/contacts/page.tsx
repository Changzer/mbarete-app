import { getTranslations } from "next-intl/server";
import { getContactsByType, getImagesByContact } from "@/lib/queries/contacts";
import { transcribeCard } from "@/lib/actions/transcribe";
import { isTranscriptionEnabled } from "@/lib/transcribe-product";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ContactManager } from "@/components/contacts/contact-manager";

export default async function ContactsPage() {
  const t = await getTranslations("contacts");
  const [suppliers, clients] = await Promise.all([
    getContactsByType("supplier"),
    getContactsByType("client"),
  ]);
  const images = await getImagesByContact([...suppliers, ...clients].map((c) => c.id));
  const withImages = <T extends { id: number }>(rows: T[]) =>
    rows.map((c) => ({ ...c, images: images.get(c.id) ?? [] }));

  const transcribe = isTranscriptionEnabled() ? transcribeCard : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold text-ink">{t("title")}</h1>

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">{t("suppliers")}</TabsTrigger>
          <TabsTrigger value="clients">{t("clients")}</TabsTrigger>
        </TabsList>
        <TabsContent value="suppliers">
          <ContactManager
            type="supplier"
            contacts={withImages(suppliers)}
            transcribe={transcribe}
          />
        </TabsContent>
        <TabsContent value="clients">
          <ContactManager type="client" contacts={withImages(clients)} transcribe={transcribe} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
