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

export function resolveProformaBank(
  accounts: BankAccountLike[],
  selectedId: number | null,
  legacy: LegacyBankFields,
): ProformaBank | null {
  const chosen =
    (selectedId !== null ? accounts.find((a) => a.id === selectedId) : undefined) ??
    accounts.find((a) => a.isDefault) ??
    accounts[0];
  if (chosen) {
    const { bankName, accountName, accountNumber, swift, bankAddress } = chosen;
    return { bankName, accountName, accountNumber, swift, bankAddress };
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
