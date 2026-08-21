import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The solid red silhouette belongs to Save and nothing else — destructive is
 * outlined, so a delete can never be mistaken for the primary action at a
 * glance. Sizes start at 44px because every one of these is pressed with a
 * thumb, often one-handed, often while holding a product.
 */
const buttonVariants = cva(
  "press focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-[13.5px] font-semibold disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-action text-white hover:bg-action-press active:bg-action-press disabled:bg-surface-2 disabled:text-faint",
        destructive:
          "border-[1.5px] border-danger-line bg-surface text-danger font-bold hover:bg-danger-soft",
        outline:
          "border-[1.5px] border-line bg-surface text-action-chrome hover:bg-action-soft disabled:text-faint",
        ghost: "text-sub hover:bg-surface-2 hover:text-ink",
        secondary:
          "bg-surface-2 text-ink hover:bg-line",
      },
      size: {
        default: "h-11 px-[18px]",
        sm: "h-9 rounded-[10px] px-3.5 text-[12.5px]",
        lg: "h-12 px-6 text-[14px]",
        icon: "h-11 w-11 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
