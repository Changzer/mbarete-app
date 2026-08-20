/**
 * Duplicate-contact detection for the market flow: after photographing dozens
 * of business cards, the same vendor inevitably gets captured twice. This is
 * a warning, never a gate — matching is deliberately loose and the person
 * decides.
 */

export type MatchCandidate = {
  id: number;
  companyName: string;
  companyNameZh: string;
  phone: string;
};

/** Digits only, so "189 6795 5270", "18967955270" and "+86-189..." compare equal. */
export function phoneDigits(value: string): string[] {
  return value
    .split(/[\/,;]+/)
    .map((part) => part.replace(/\D/g, ""))
    // Anything shorter is a fragment, not a phone number worth matching on.
    .filter((digits) => digits.length >= 7);
}

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * The first existing contact that looks like the same vendor: any shared
 * phone number (ignoring formatting and a leading country code), or the same
 * company name in either language.
 */
export function findSimilarContact(
  candidates: MatchCandidate[],
  draft: { companyName?: string; companyNameZh?: string; phone?: string },
): MatchCandidate | undefined {
  const draftPhones = draft.phone ? phoneDigits(draft.phone) : [];
  const nameEn = draft.companyName ? normalizeName(draft.companyName) : "";
  const nameZh = draft.companyNameZh ? normalizeName(draft.companyNameZh) : "";

  return candidates.find((candidate) => {
    if (draftPhones.length > 0) {
      const theirs = phoneDigits(candidate.phone);
      const shared = theirs.some((a) =>
        draftPhones.some((b) => a === b || a.endsWith(b) || b.endsWith(a)),
      );
      if (shared) return true;
    }
    if (nameEn && normalizeName(candidate.companyName) === nameEn) return true;
    if (nameZh && candidate.companyNameZh && normalizeName(candidate.companyNameZh) === nameZh) {
      return true;
    }
    return false;
  });
}
