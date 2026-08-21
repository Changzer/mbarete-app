import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status is never colour alone: every one of these carries words, and the
 * icon-bearing states carry a glyph too. The action red is reserved for
 * actions — a status that has gone wrong uses the danger tokens, which are
 * visibly deeper and softer, and its copy leads with a verb ("Retry").
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors duration-150 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-bg",
        secondary: "bg-surface-2 text-sub",
        outline: "border border-line text-sub",
        /** Safe / stored / done. */
        success: "bg-ok-soft text-ok",
        /** Needs attention, but nothing is lost. */
        warning: "bg-warn-soft text-warn",
        /** A real failure — pair it with a retry. */
        destructive: "bg-danger-soft text-danger",
        /** In flight: the neutral middle of the sync ladder. */
        sync: "bg-surface-2 text-sub",
        /** Brand-tinted, for counts and quiet emphasis on the action itself. */
        action: "bg-action-soft text-action-chrome",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
