import * as React from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "flex h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[13.5px] text-ink transition-colors placeholder:text-faint focus-visible:border-action focus-ring disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders the field in the data register — SKU, prices, MOQ, pack, rates. */
  numeric?: boolean;
  /** Unit that belongs to the value, e.g. `pcs`, `cm`, `kg`, `%`. */
  suffix?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, numeric, suffix, ...props }, ref) => {
    const input = (
      <input
        type={type}
        // Marks the box a finger is aimed at. On a suffixed field the wrapper
        // below carries it instead, since that is the frame the user sees.
        data-touch-target={suffix ? undefined : ""}
        className={cn(
          fieldClass,
          numeric && "font-mono font-medium tabular-nums",
          // The suffix sits inside the field's border, so the input loses its
          // own frame and the wrapper carries it instead.
          suffix && "h-full border-0 bg-transparent pr-1 focus-visible:border-0",
          className,
        )}
        ref={ref}
        {...props}
      />
    );

    if (!suffix) return input;

    return (
      <div
        data-touch-target=""
        className={cn(
          fieldClass,
          "items-center gap-1 px-0 pl-3 pr-3 focus-within:border-action",
        )}
      >
        {input}
        {/* Decorative: the unit is already in the field's label and its
            validation copy, so a screen reader gains nothing by reading it. */}
        <span aria-hidden className="shrink-0 text-[11px] font-medium text-faint">
          {suffix}
        </span>
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
