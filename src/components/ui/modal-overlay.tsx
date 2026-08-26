import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The accessible shape of the click-outside-to-close overlay this app hand-rolls
 * in a dozen places.
 *
 * The pattern being replaced was a backdrop `<div onClick={close}>` wrapping a
 * panel `<div onClick={stopPropagation}>`. That has two problems beyond the lint
 * warnings: the backdrop is unreachable by keyboard, so a keyboard-only user has
 * no way to dismiss; and `stopPropagation` on the panel only exists to undo the
 * backdrop being its parent.
 *
 * Here the backdrop is a SIBLING, so nothing needs to stop propagation, and it is
 * a real `<button>` rather than a div — announced and operable rather than an
 * invisible click target. It is kept out of the tab order deliberately: Escape is
 * the keyboard path to dismiss, and a full-screen tab stop in front of the dialog
 * would be noise.
 */
export function ModalOverlay({
  onClose,
  children,
  label,
  labelledBy,
  className,
  panelClassName,
  backdropClassName,
  closeLabel = "Close",
}: {
  onClose: () => void;
  children: ReactNode;
  /** Accessible name for the dialog. Use `labelledBy` when a heading exists. */
  label?: string;
  labelledBy?: string;
  /**
   * Positioning for the outer container (e.g. "flex items-end"). Defaults to
   * `fixed`; pass `absolute` to scope the overlay to a positioned ancestor, as
   * the phone-frame previews do.
   */
  className?: string;
  panelClassName?: string;
  backdropClassName?: string;
  closeLabel?: string;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={cn("fixed inset-0 z-50", className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={closeLabel}
        onClick={onClose}
        className={cn(
          "absolute inset-0 h-full w-full cursor-default bg-slate-950/60",
          backdropClassName,
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className={cn("relative", panelClassName)}
      >
        {children}
      </div>
    </div>
  );
}
