"use server";

export type SignupResult = { error: "closed" };

/** Retired public action: old links/forms cannot create companies, in any mode. */
export async function signUp(
  _prev: SignupResult | undefined,
  _formData: FormData,
): Promise<SignupResult> {
  void _prev;
  void _formData;
  return { error: "closed" };
}
