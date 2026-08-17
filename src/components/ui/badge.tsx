import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
        secondary: "border-transparent bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100",
        destructive:
          "border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
        warning:
          "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        success:
          "border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
        outline: "border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300",
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
