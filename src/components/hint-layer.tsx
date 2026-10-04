"use client";

import { useEffect, useRef, useState } from "react";

type Hint = { text: string; x: number; y: number; below: boolean };

const SELECTOR = "[data-hint],[title]";

/**
 * Turns every `title` / `data-hint` on the page into a styled tooltip that
 * also works with keyboard focus. Native titles are moved to `data-hint` so
 * the browser bubble does not appear on top of ours.
 */
export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  const timer = useRef<number | null>(null);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const adopt = (el: Element) => {
      const title = el.getAttribute("title");
      if (title) {
        el.setAttribute("data-hint", title);
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
      }
      return el.getAttribute("data-hint");
    };

    const hide = () => {
      if (timer.current) window.clearTimeout(timer.current);
      current.current = null;
      setHint(null);
    };

    const show = (target: EventTarget | null, delay: number) => {
      const el = target instanceof Element ? target.closest(SELECTOR) : null;
      if (!el) return hide();
      if (el === current.current) return;
      const text = adopt(el);
      if (!text) return hide();
      current.current = el;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.top < 56;
        setHint({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };

    const onOver = (e: PointerEvent) => e.pointerType !== "touch" && show(e.target, 300);
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(":focus-visible")) show(e.target, 0);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!hint) return null;
  const left = Math.min(Math.max(hint.x, 140), (typeof window !== "undefined" ? window.innerWidth : 1000) - 140);
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-64 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium leading-relaxed text-slate-50 shadow-lg ring-1 ring-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300"
      style={{ left, top: hint.y, transform: `translate(-50%, ${hint.below ? "0" : "-100%"})` }}
    >
      {hint.text}
    </div>
  );
}
