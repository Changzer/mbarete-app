"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Everything else a Yiwu quote is ever written in, behind the two that matter. */
const OTHER_CURRENCIES = ["EUR", "GBP", "PYG", "BRL", "ARS", "JPY", "HKD", "AUD"];

/**
 * Currency as two buttons, not a text field.
 *
 * A supplier quotes in yuan and the order goes out in dollars; those two cover
 * essentially every capture, and typing three letters into a free-text box on
 * a phone keyboard produced "usd", "US$" and "rmb" in the same catalog. The
 * rest are still reachable, one tap further in.
 */
export function CurrencyField({
  value,
  onChange,
  name = "currency",
  label,
  otherLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  label: string;
  otherLabel: string;
}) {
  const isOther = value !== "CNY" && value !== "USD";

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold leading-none text-sub">{label}</span>
      <input type="hidden" name={name} value={value} />
      <div className="flex gap-1.5">
        <div
          className="flex flex-1 gap-1 rounded-[10px] border border-line bg-surface-2 p-1"
          role="group"
          aria-label={label}
        >
          {(["CNY", "USD"] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={value === code}
              data-testid={`currency-${code}`}
              onClick={() => onChange(code)}
              className={`press focus-ring h-9 flex-1 rounded-[8px] font-mono text-[12.5px] font-semibold ${
                value === code ? "bg-action text-white" : "text-sub hover:text-ink"
              }`}
            >
              {code === "CNY" ? "¥ CNY" : "$ USD"}
            </button>
          ))}
        </div>
        <Select
          value={isOther ? value : ""}
          onValueChange={(next) => next && onChange(next)}
        >
          <SelectTrigger
            aria-label={otherLabel}
            data-testid="currency-other"
            className={`w-28 shrink-0 font-mono ${isOther ? "border-action text-ink" : "text-sub"}`}
          >
            <SelectValue placeholder={otherLabel} />
          </SelectTrigger>
          <SelectContent>
            {OTHER_CURRENCIES.map((code) => (
              <SelectItem key={code} value={code} className="font-mono">
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
