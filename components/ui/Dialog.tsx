"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * アクセシブルなモーダルダイアログ。
 * - role="dialog" / aria-modal / aria-labelledby
 * - Escape で閉じる、Tab でダイアログ内をループ
 * - 開いたときに閉じるボタンへフォーカスし、閉じたら元の要素へ戻す
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (
        e.shiftKey &&
        (active === first || !panelRef.current.contains(active))
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white w-full max-w-2xl max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-lg pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-200 bg-white px-4 py-2">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="inline-flex items-center justify-center min-h-12 min-w-12 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <svg
              aria-hidden="true"
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
