"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Search, X } from "lucide-react";

const MAX_RECENT = 6;

function readRecent(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberQuery(key: string, query: string) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return;
  try {
    const next = [trimmed, ...readRecent(key).filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage is a convenience here; searching still works without it.
  }
}

/**
 * Search over name, SKU and supplier, with the last few queries kept on the
 * phone. In a market the same booth is looked up a dozen times a day, and
 * retyping 华瑞日用品 on a phone keyboard is the slowest part of the job.
 */
export function SearchBar({
  value,
  onChange,
  placeholder,
  recentKey,
  recentLabel,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** localStorage key for the recent-query list; omit to keep no history. */
  recentKey?: string;
  recentLabel: string;
  clearLabel: string;
  className?: string;
}) {
  const [recent, setRecent] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recentKey) setRecent(readRecent(recentKey));
  }, [recentKey]);

  function commit(query: string) {
    if (!recentKey) return;
    rememberQuery(recentKey, query);
    setRecent(readRecent(recentKey));
  }

  // Recents are an alternative to typing, so they are worth showing only while
  // the field is empty and has the agent's attention.
  const showRecent = focused && value === "" && recent.length > 0;

  return (
    <div className={className}>
      <div className="focus-within:border-action flex h-11 items-center gap-2 rounded-[10px] border border-line bg-surface px-3">
        <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={1.5} />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          value={value}
          placeholder={placeholder}
          data-testid="search-input"
          enterKeyHint="search"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // A blur that lands on a recent chip must not unmount it first.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(value);
              inputRef.current?.blur();
            }
            if (e.key === "Escape") onChange("");
          }}
          className="focus-ring min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            aria-label={clearLabel}
            data-testid="search-clear"
            onClick={() => {
              commit(value);
              onChange("");
              inputRef.current?.focus();
            }}
            className="press focus-ring -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sub"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      {showRecent ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="recent-queries">
          <span className="flex items-center gap-1 text-[11px] font-semibold text-faint">
            <Clock className="h-3 w-3" strokeWidth={1.5} />
            {recentLabel}
          </span>
          {recent.map((query) => (
            <button
              key={query}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(query)}
              className="press focus-ring inline-flex h-9 max-w-[60vw] items-center truncate rounded-full border border-line bg-surface-2 px-3 text-[12px] text-sub"
            >
              {query}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
