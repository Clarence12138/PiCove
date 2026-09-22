import { useId } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n/use-t";

export function ProjectSessionConfirm({
  title,
  body,
  pending,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const id = useId();
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        data-session-confirm
        className="theme-floating-surface w-full max-w-sm rounded-lg border border-border bg-surface-raised p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) onCancel();
        }}
      >
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            autoFocus
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t("commonCancel")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="rounded-md bg-danger px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {t("sessionsDeletePermanently")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
