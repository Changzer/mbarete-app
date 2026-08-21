"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A filter chip: pill, 36px tall inside a 44px scroll lane, selected state
 * carried by the action tint plus weight — not by colour on its own.
 */
export function Chip({
  selected,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "press focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold [&_svg]:size-3.5",
        selected
          ? "border-action bg-action-soft text-action-chrome"
          : "border-line bg-surface text-sub hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * The lane the chips live in. Chips scroll horizontally on a phone rather than
 * wrapping into three rows that push the list below the fold; the 44px height
 * is the touch target even though the chips themselves are 36.
 */
export function ChipRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:flex-wrap md:px-0",
        className,
      )}
      {...props}
    />
  );
}
