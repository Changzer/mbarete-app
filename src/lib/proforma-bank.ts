/**
 * Which bank details an order's proforma shows.
 *
 * The order's own choice wins; an order that never chose follows the default
 * account. Installations from before multiple accounts existed may have bank
 * details only on the company profile — those still print, so an upgrade
 * never blanks the payment block. Pure, so it is testable without a database.
 */

export type ProformaBank = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  swift: string;
  bankAddress: string;
};

export type BankAccountLike = ProformaBank & {
  id: number;
  isDefault: boolean;
};

export type LegacyBankFields = {
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankSwift: string;
  bankAddress: string;
};

/** The account an order follows while it has no choice of its own. */
export function defaultBankAccount<T extends { isDefault: boolean }>(
  accounts: T[],
): T | undefined {
  return accounts.find((a) => a.isDefault) ?? accounts[0];
}

const hasContent = (b: ProformaBank) =>
  Boolean(b.bankName || b.accountName || b.accountNumber || b.swift || b.bankAddress);

export function resolveProformaBank(
  accounts: BankAccountLike[],
  selectedId: number | null,
  legacy: LegacyBankFields,
): ProformaBank | null {
  const chosen =
    (selectedId !== null ? accounts.find((a) => a.id === selectedId) : undefined) ??
    defaultBankAccount(accounts);
  if (chosen) {
    const { bankName, accountName, accountNumber, swift, bankAddress } = chosen;
    const bank = { bankName, accountName, accountNumber, swift, bankAddress };
    // A label-only account must not print an empty BANK DETAILS heading.
    return hasContent(bank) ? bank : null;
  }
  if (legacy.bankName || legacy.bankAccountName || legacy.bankAccountNumber) {
    return {
      bankName: legacy.bankName,
      accountName: legacy.bankAccountName,
      accountNumber: legacy.bankAccountNumber,
      swift: legacy.bankSwift,
      bankAddress: legacy.bankAddress,
    };
  }
  return null;
}
