"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Fires a confirmation toast when the page was arrived at through a save
 * redirect (?saved=1), then strips the flag so a reload or a shared URL
 * does not repeat it. The save itself happens in a server action that ends
 * in redirect() — client code after the call never runs — so the landing
 * page is the only place the "it worked" signal can live.
 */
export function SavedToast({ message }: { message: string }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current || params.get("saved") !== "1") return;
    fired.current = true;
    toast(message);
    const rest = new URLSearchParams(params);
    rest.delete("saved");
    const qs = rest.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, pathname, router, toast, message]);

  return null;
}
