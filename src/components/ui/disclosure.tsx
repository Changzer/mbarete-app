"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A section the capture form can fold away.
 *
 * Measuring a carton is not something that happens at the booth — the buyer
 * photographs, prices and moves on, and the tape measure comes out later. Ten
 * dimension fields between the price and the Save button turn a 20-second
 * capture into a form to be dreaded, so they fold, with a summary line saying
 * what is inside.
 */
export function Disclosure({
  title,
  hint,
  summary,
  defaultOpen = false,
  children,
  "data-testid": testId,
}: {
  title: string;
  hint?: string;
  /** Shown beside the title while closed — what would be filled in there. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        data-testid={testId}
        className="focus-ring flex min-h-14 w-full items-center gap-3 px-3.5 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-bold text-ink">{title}</span>
          {summary ? (
            <span className="block truncate font-mono text-[11px] text-sub">{summary}</span>
          ) : hint ? (
            <span className="block truncate text-[11px] text-sub">{hint}</span>
          ) : null}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          strokeWidth={1.5}
        />
      </button>
      {open ? (
        <div id={contentId} className="border-t border-line p-3.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A titled group inside a form. The kicker is set in the mono register and in
 * caps — it reads as a divider rather than as another thing to fill in.
 */
export function FormSection({
  kicker,
  children,
  className,
}: {
  kicker?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 ${className ?? ""}`}>
      {kicker ? (
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-sub">
          {kicker}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** Label above field, the shape every field in these forms takes. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-semibold leading-none text-sub"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-relaxed text-sub">{hint}</p> : null}
    </div>
  );
}
