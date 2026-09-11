import { PublicPolicy } from "@/components/legal/public-policy";

export default async function PolicyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <PublicPolicy locale={locale} kind="terms" />;
}
