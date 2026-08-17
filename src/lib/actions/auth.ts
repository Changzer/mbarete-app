"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/lib/auth";

export async function signOutAction(locale: string) {
  await signOut({ redirectTo: `/${locale}/login` });
}

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: (formData.get("callbackUrl") as string) || "/catalog",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "invalid";
    }
    throw error;
  }
}
