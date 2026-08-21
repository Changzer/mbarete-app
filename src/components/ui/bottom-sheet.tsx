"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A sheet that stays a sheet: bottom-anchored at every width, for surfaces
 * whose whole point is the thumb reach — order actions, the sync centre, a
 * conflict to settle. Anything that is really a document (a product's detail)
 * uses `Dialog`, which becomes a centred dialog on a desktop.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
  ...props
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Omitted descriptions still get a node, so Radix never warns. */
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<typeof DialogContent>, "title">) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheet className={className} {...props}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
