"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Package, ClipboardList, BarChart3 } from "lucide-react";

/**
 * The first row of the landing page. Marketing screenshots dropped into
 * public/landing/slides/ become the slides (the page lists that folder at
 * render time); until any exist, three styled feature panels stand in so
 * the page never ships a broken first impression.
 */
export function HeroCarousel({ images }: { images: string[] }) {
  const t = useTranslations("landing.carousel");
  const fallback = [
    { icon: Package, title: t("slide1Title"), body: t("slide1Body") },
    { icon: ClipboardList, title: t("slide2Title"), body: t("slide2Body") },
    { icon: BarChart3, title: t("slide3Title"), body: t("slide3Body") },
  ];
  const count = images.length > 0 ? images.length : fallback.length;

  const [index, setIndex] = useState(0);
  const paused = useRef(false);

  const go = useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (!paused.current) setIndex((i) => (i + 1) % count);
    }, 5000);
    return () => clearInterval(timer);
  }, [count]);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-line bg-surface"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onTouchStart={() => (paused.current = true)}
      onTouchEnd={() => (paused.current = false)}
    >
      <div
        className="flex transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {images.length > 0
          ? images.map((src) => (
              // Marketing shots of unknown dimensions; plain <img> keeps the strip simple.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt=""
                className="aspect-[16/9] w-full shrink-0 object-cover"
                draggable={false}
              />
            ))
          : fallback.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="flex aspect-[16/9] w-full shrink-0 flex-col items-center justify-center gap-4 bg-gradient-to-br from-brand-50 to-brand-100 px-8 text-center dark:from-brand-900/40 dark:to-brand-800/30"
              >
                <Icon className="h-12 w-12 text-brand-600 dark:text-brand-300" aria-hidden />
                <h2 className="text-2xl font-semibold text-ink sm:text-3xl">{title}</h2>
                <p className="max-w-xl text-sm text-sub sm:text-base">{body}</p>
              </div>
            ))}
      </div>

      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label={t("prev")}
            onClick={() => go(index - 1)}
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-line bg-surface/80 p-2 text-ink backdrop-blur transition hover:bg-surface"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t("next")}
            onClick={() => go(index + 1)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-line bg-surface/80 p-2 text-ink backdrop-blur transition hover:bg-surface"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === index}
                onClick={() => go(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index ? "w-6 bg-action" : "w-2 bg-faint hover:bg-sub"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
