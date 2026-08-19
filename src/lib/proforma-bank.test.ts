import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProformaBank, type BankAccountLike } from "./proforma-bank";

const account = (over: Partial<BankAccountLike>): BankAccountLike => ({
  id: 1,
  bankName: "Tailong Bank",
  accountName: "Yiwu Mbarete Import Export Co. Ltd.",
  accountNumber: "1234567890",
  swift: "TLBKCN2H",
  bankAddress: "Yiwu, Zhejiang",
  isDefault: false,
  ...over,
});

const NO_LEGACY = {
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankSwift: "",
  bankAddress: "",
};

test("proforma bank: the order's own choice wins over the default", () => {
  const usd = account({ id: 2, bankName: "CMB", accountNumber: "USD-999", isDefault: false });
  const rmb = account({ id: 1, isDefault: true });
  const bank = resolveProformaBank([rmb, usd], 2, NO_LEGACY);
  assert.equal(bank?.bankName, "CMB");
  assert.equal(bank?.accountNumber, "USD-999");
});

test("proforma bank: no choice falls back to the default account", () => {
  const usd = account({ id: 2, bankName: "CMB", isDefault: true });
  const rmb = account({ id: 1, isDefault: false });
  const bank = resolveProformaBank([rmb, usd], null, NO_LEGACY);
  assert.equal(bank?.bankName, "CMB");
});

test("proforma bank: a stale selection (deleted account) follows the default", () => {
  const rmb = account({ id: 1, isDefault: true });
  const bank = resolveProformaBank([rmb], 99, NO_LEGACY);
  assert.equal(bank?.bankName, "Tailong Bank");
});

test("proforma bank: no default flagged still prints the first account", () => {
  const bank = resolveProformaBank([account({ id: 5, isDefault: false })], null, NO_LEGACY);
  assert.equal(bank?.bankName, "Tailong Bank");
});

test("proforma bank: pre-migration installs print the legacy company fields", () => {
  const bank = resolveProformaBank([], null, {
    bankName: "Old Bank",
    bankAccountName: "Mbarete",
    bankAccountNumber: "111",
    bankSwift: "OLDB",
    bankAddress: "Somewhere",
  });
  assert.equal(bank?.bankName, "Old Bank");
  assert.equal(bank?.accountName, "Mbarete");
  assert.equal(bank?.swift, "OLDB");
});

test("proforma bank: nothing anywhere means no bank block at all", () => {
  assert.equal(resolveProformaBank([], null, NO_LEGACY), null);
});
