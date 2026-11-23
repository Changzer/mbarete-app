"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

export function OrderSection({
  title,
  description,
  headerAside,
  defaultOpen = false,
  className,
  children,
  "data-testid": testId,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  headerAside?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
  "data-testid": string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      className={`rounded-[12px] border border-line bg-surface ${className ?? ""}`}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-x-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="focus-ring flex min-h-12 min-w-0 flex-[1_1_16rem] items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-surface-2"
          data-testid={`${testId}-toggle`}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{title}</span>
            {description ? (
              <span className="mt-0.5 block text-[11.5px] leading-snug text-sub">{description}</span>
            ) : null}
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
        {headerAside ? (
          <div className="flex flex-wrap items-center justify-end gap-2 px-2 py-1">{headerAside}</div>
        ) : null}
      </div>
      <div id={contentId} hidden={!open} className="border-t border-line p-4">
        {children}
      </div>
    </section>
  );
}
