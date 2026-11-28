import { convert, roundMoney, type CurrencyRates } from "@/lib/calculations";

export function calculateConversion({
  sourceAmount,
  sourceCurrency,
  settlementAmount,
  settlementCurrency,
  rates,
}: {
  sourceAmount: number;
  sourceCurrency: string;
  settlementAmount: number;
  settlementCurrency: string;
  rates: CurrencyRates;
}) {
  const expectedSettlement = roundMoney(convert(sourceAmount, sourceCurrency, settlementCurrency, rates));
  return {
    effectiveRate: sourceAmount > 0 ? settlementAmount / sourceAmount : 0,
    expectedSettlement,
    conversionCost: roundMoney(expectedSettlement - settlementAmount),
  };
}
