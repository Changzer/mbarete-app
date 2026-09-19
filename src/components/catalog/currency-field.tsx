"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Everything else a Yiwu quote is ever written in, behind the ones that matter. */
const OTHER_CURRENCIES = ["EUR", "GBP", "PYG", "BRL", "ARS", "JPY", "HKD", "AUD"];

const LABELS: Record<string, string> = { CNY: "¥ RMB", USD: "$ USD", BRL: "R$ BRL" };

/** What the supplier's price is written in: yuan or dollars cover every capture. */
export const COST_CHOICES: readonly string[] = ["CNY", "USD"];
/** What the client is invoiced in: the three markets Mbarete sells into. */
export const SALE_CHOICES: readonly string[] = ["USD", "CNY", "BRL"];

/**
 * Currency as a row of buttons, not a text field.
 *
 * A supplier quotes in yuan and the order goes out in dollars or reais;
 * a handful of codes cover essentially every capture, and typing three
 * letters into a free-text box on a phone keyboard produced "usd", "US$"
 * and "rmb" in the same catalog. The rest are still reachable, one tap
 * further in.
 */
export function CurrencyField({
  value,
  onChange,
  name = "currency",
  label,
  otherLabel,
  choices = COST_CHOICES,
  others = OTHER_CURRENCIES,
  testId = "currency",
  className = "col-span-2",
}: {
  value: string;
  onChange: (value: string) => void;
  /** The hidden input's name; "" renders no hidden input (state-only use). */
  name?: string;
  label: string;
  otherLabel: string;
  /** The codes that get a button of their own. */
  choices?: readonly string[];
  /** The codes behind the "other" picker; the buttons' codes are left out. */
  others?: readonly string[];
  /** Prefix for the buttons' test ids: `${testId}-${code}`. */
  testId?: string;
  className?: string;
}) {
  const isOther = !choices.includes(value);
  const rest = others.filter((code) => !choices.includes(code));

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-semibold leading-none text-sub">{label}</span>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="flex gap-1.5">
        <div
          className="flex flex-1 gap-1 rounded-[10px] border border-line bg-surface-2 p-1"
          role="group"
          aria-label={label}
        >
          {choices.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={value === code}
              data-testid={`${testId}-${code}`}
              onClick={() => onChange(code)}
              className={`press focus-ring h-11 flex-1 rounded-[8px] font-mono text-[12.5px] font-semibold ${
                value === code ? "bg-action text-white" : "text-sub hover:text-ink"
              }`}
            >
              {LABELS[code] ?? code}
            </button>
          ))}
        </div>
        {rest.length > 0 ? (
          <Select
            value={isOther ? value : ""}
            onValueChange={(next) => next && onChange(next)}
          >
            <SelectTrigger
              aria-label={otherLabel}
              data-testid={`${testId}-other`}
              className={`w-28 shrink-0 font-mono ${isOther ? "border-action text-ink" : "text-sub"}`}
            >
              <SelectValue placeholder={otherLabel} />
            </SelectTrigger>
            <SelectContent>
              {rest.map((code) => (
                <SelectItem key={code} value={code} className="font-mono">
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
