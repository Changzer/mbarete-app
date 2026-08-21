import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One line and, when there is one, the action that ends the emptiness. No
 * illustration: an empty catalog on the first morning of a market run is a
 * to-do, not a moment to decorate.
 */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[12px] border border-dashed border-line bg-surface px-5 py-10 text-center",
        className,
      )}
      {...props}
    >
      {icon ? <span className="text-faint [&_svg]:size-7">{icon}</span> : null}
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      {hint ? <p className="max-w-xs text-[12px] leading-relaxed text-sub">{hint}</p> : null}
      {action}
    </div>
  );
}
