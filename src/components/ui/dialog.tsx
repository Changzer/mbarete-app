"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[rgba(20,12,8,.5)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

/** Shared by both anchorings: the surface itself, and the 250ms it moves in. */
const sheetBase =
  "fixed z-50 flex flex-col gap-3 overflow-y-auto border border-line bg-surface text-ink shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:duration-[250ms] data-[state=closed]:duration-200 data-[state=open]:ease-out";

/** Bottom-anchored: the thumb's edge, a drag handle, a 20px top radius. */
const sheetAnchor =
  "inset-x-0 bottom-0 max-h-[88vh] rounded-t-[20px] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full";

/** Centred, from `sm` up, where there is no thumb and no bottom edge to hug. */
const dialogAnchor =
  "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[16px] sm:p-6 sm:pb-6 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95";

/**
 * On a phone this is a bottom sheet — anchored to the edge the thumb reaches,
 * with a drag handle and a 20px top radius — and from `sm` up it becomes the
 * centred dialog the desktop expects. One component, because every caller
 * wants both behaviours and none of them wants to choose.
 */
function DialogContent({
  className,
  children,
  hideClose,
  sheet,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  hideClose?: boolean;
  /** Stay a bottom sheet at every width — see `BottomSheet`. */
  sheet?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          sheetBase,
          sheetAnchor,
          sheet ? "sm:mx-auto sm:max-w-xl" : dialogAnchor,
          className,
        )}
        {...props}
      >
        {/* Purely a grab affordance — the sheet is dismissed by the scrim, the
            close button or Escape, all of which a screen reader already has. */}
        <span
          aria-hidden
          className={cn("mx-auto -mt-1 mb-1 h-1 w-10 shrink-0 rounded-full bg-line", sheet ? "" : "sm:hidden")}
        />
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="focus-ring absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-sub hover:bg-surface-2 hover:text-ink sm:right-4 sm:top-4">
            <X className="h-4 w-4" strokeWidth={1.5} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-11 text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[17px] font-extrabold leading-tight text-ink", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[12px] text-sub", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
