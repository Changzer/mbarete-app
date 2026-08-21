"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "mb-theme";

/**
 * Applied before paint by the inline script in the layout and again here on
 * every change, so the two can never disagree about what is on <html>.
 */
export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

function readStored(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Private mode, or storage disabled — the phone's own preference stands.
  }
  return "system";
}

/**
 * localStorage is an external store, so it is read as one: the server and the
 * first client paint both say "system" (the markup the boot script's attribute
 * is already consistent with), and the real choice arrives without a cascading
 * re-render or a hydration mismatch.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the choice should move this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Appearance control for More → the three real answers a person has: follow
 * the phone, or override it in either direction. A market stall in daylight
 * and a hotel room at night are different rooms, and the phone is often set
 * for neither.
 */
export function ThemeToggle() {
  const t = useTranslations("more");
  const choice = useSyncExternalStore(subscribe, readStored, () => "system" as ThemeChoice);

  function pick(next: ThemeChoice) {
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The attribute is already set; it just will not survive a reload.
    }
    listeners.forEach((notify) => notify());
  }

  const options: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
    { value: "system", label: t("themeSystem"), Icon: Monitor },
    { value: "light", label: t("themeLight"), Icon: Sun },
    { value: "dark", label: t("themeDark"), Icon: Moon },
  ];

  return (
    <div
      className="flex gap-1 rounded-full border border-line bg-surface-2 p-1"
      role="group"
      aria-label={t("theme")}
      data-testid="theme-toggle"
    >
      {options.map(({ value, label, Icon }) => {
        const active = choice === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => pick(value)}
            aria-pressed={active}
            data-testid={`theme-${value}`}
            className={`press focus-ring flex h-11 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${
              active
                ? "bg-action text-white"
                : "text-sub hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.5} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Runs before first paint so a dark-choosing agent never gets a white flash.
 * Inlined as a string because it has to execute ahead of React hydration.
 */
export const themeBootScript = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v)}}catch(e){}})()`;
