import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";

/** Keep old referral URLs useful, without exposing account creation. */
export default async function SignupPage() {
  redirect({ href: "/login", locale: await getLocale() });
}
