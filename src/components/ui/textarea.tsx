import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "focus-ring flex min-h-20 w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-[13.5px] leading-relaxed text-ink transition-colors placeholder:text-faint focus-visible:border-action disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
