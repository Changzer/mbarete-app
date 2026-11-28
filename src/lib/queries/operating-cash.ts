import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  bankAccounts,
  cashBalanceChecks,
  cashTransactions,
  operatingExpenses,
  orderExpenses,
  orderPayments,
} from "@/db/schema";
import type { OperatingCashInput } from "@/lib/operating-cash";

export async function getOperatingCashData(companyId: number): Promise<OperatingCashInput> {
  const [accounts, payments, expenses, overhead, transactions, balanceChecks] = await Promise.all([
    db.select().from(bankAccounts).where(eq(bankAccounts.companyId, companyId)),
    db.select().from(orderPayments).where(eq(orderPayments.companyId, companyId)),
    db.select().from(orderExpenses).where(eq(orderExpenses.companyId, companyId)),
    db.select().from(operatingExpenses).where(eq(operatingExpenses.companyId, companyId)).orderBy(desc(operatingExpenses.spentOn), desc(operatingExpenses.id)),
    db.select().from(cashTransactions).where(eq(cashTransactions.companyId, companyId)).orderBy(desc(cashTransactions.transactedOn), desc(cashTransactions.id)),
    db.select().from(cashBalanceChecks).where(eq(cashBalanceChecks.companyId, companyId)).orderBy(desc(cashBalanceChecks.checkedOn), desc(cashBalanceChecks.id)),
  ]);
  return {
    accounts,
    payments,
    orderExpenses: expenses,
    operatingExpenses: overhead,
    transactions,
    balanceChecks,
  };
}
