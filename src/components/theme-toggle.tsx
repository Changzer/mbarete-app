"use client";

import { useEffect, useState } from "react";
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
 * Appearance control for More → the three real answers a person has: follow
 * the phone, or override it in either direction. A market stall in daylight
 * and a hotel room at night are different rooms, and the phone is often set
 * for neither.
 */
export function ThemeToggle() {
  const t = useTranslations("more");
  // Starts at the server-rendered value and corrects on mount: the markup is
  // identical for every choice, so there is nothing to mismatch.
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => setChoice(readStored()), []);

  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next);
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The attribute is already set; it just will not survive a reload.
    }
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
            className={`press focus-ring flex h-9 min-w-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${
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
