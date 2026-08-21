import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton rounded-[8px]", className)}
      {...props}
    />
  );
}

/**
 * The same geometry as a real product row — 74px photo, three text lines — so
 * the list does not reflow when the content lands. Skeletons are for the first
 * load only; a later load keeps the stale rows on screen instead.
 */
export function ProductRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-line bg-surface p-2.5">
      <Skeleton className="h-[74px] w-[74px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
    </div>
  );
}

export function ProductListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" data-testid="catalog-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <ProductRowSkeleton key={i} />
      ))}
    </div>
  );
}
