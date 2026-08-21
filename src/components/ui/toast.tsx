"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check } from "lucide-react";

type Toast = { id: number; message: string };

const ToastContext = createContext<((message: string) => void) | null>(null);

/**
 * Confirmations only. An error never becomes a toast — it stays inline at the
 * field that caused it, where it can still be fixed after 2.6 seconds have
 * passed.
 */
export function useToast() {
  const show = useContext(ToastContext);
  return useCallback(
    (message: string) => show?.(message),
    [show],
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const show = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, message }]);
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, 2600),
    );
  }, []);

  // A capture flow can leave a toast mid-flight when the page navigates.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above the tab bar, never over it: the bar is how you leave the screen
          the toast is confirming. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 print:hidden md:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-testid="toast"
            className="flex max-w-full items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[12.5px] font-semibold text-bg shadow-xl [animation:mb-toast-in_220ms_ease-out]"
          >
            <Check className="h-4 w-4 shrink-0 text-ok" strokeWidth={1.5} />
            <span className="truncate">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
