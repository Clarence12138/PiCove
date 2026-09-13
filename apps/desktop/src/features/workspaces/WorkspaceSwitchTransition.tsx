import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useAppStore } from "../../lib/stores/app-store";
import { useT } from "../../lib/i18n/use-t";
import { workspaceDisplayName } from "./WorkspacePicker";
import { navigateToWorkspace } from "./workspace-navigation";

const LOADING_DELAY_MS = 180;

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-surface-overlay motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * Native-feeling workspace switch: the stale conversation fades out into a
 * chat-shaped skeleton, and the new workspace fades back in once ready.
 */
export function WorkspaceSwitchTransition({ children }: { children: ReactNode }) {
  const target = useAppStore((s) => s.workspaceSwitchTarget);
  const failure = useAppStore((s) => s.workspaceSwitchError);
  const contentKey = useAppStore(
    (s) =>
      `${s.workspace?.id}:${s.workspace?.revision}:${s.session?.sessionId}:${s.session?.revision}`,
  );
  const t = useT();
  const switching = target !== null;
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [settledContentKey, setSettledContentKey] = useState(contentKey);
  if (!switching && contentKey !== settledContentKey) setSettledContentKey(contentKey);

  useEffect(() => {
    if (!switching) {
      setShowSkeleton(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSkeleton(true), LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [switching]);

  // Brief contention keeps the old content visible but inert. Hide committed
  // intermediate destinations until the last requested destination settles.
  const intermediateContent = switching && contentKey !== settledContentKey;
  const hideContent = switching && (showSkeleton || intermediateContent);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          hideContent ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-hidden={switching || undefined}
        inert={switching || undefined}
        style={intermediateContent ? { visibility: "hidden" } : undefined}
      >
        {children}
      </div>
      {switching && showSkeleton && (
        <div
          role="status"
          aria-live="polite"
          className="workspace-switch-skeleton absolute inset-0 z-30 flex flex-col bg-surface"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
            <SkeletonBlock className="h-4 w-40" />
            <span className="text-xs text-muted">
              {t("workspacesSwitchingTo", { name: workspaceDisplayName(target) })}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-6">
            <SkeletonBlock className="h-10 w-3/5 self-end" />
            <SkeletonBlock className="h-24 w-4/5" />
            <SkeletonBlock className="h-10 w-2/5 self-end" />
            <SkeletonBlock className="h-16 w-3/4" />
          </div>
          <div className="shrink-0 px-6 pb-6">
            <SkeletonBlock className="h-20 w-full rounded-xl" />
          </div>
        </div>
      )}
      {!switching && failure && (
        <div
          role="alert"
          className="absolute inset-x-4 bottom-4 z-30 flex items-start gap-3 rounded-lg border border-warning/40 bg-surface-raised p-3 shadow-lg"
        >
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {t("workspacesOpenFailed", { name: workspaceDisplayName(failure.target.cwd) })}
            </p>
            <p className="mt-1 text-muted">{failure.message}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-overlay"
            onClick={() => void navigateToWorkspace(failure.target)}
          >
            {t("workspacesRetry")}
          </button>
          <button
            type="button"
            aria-label={t("commonClose")}
            className="rounded-md p-1 text-muted hover:bg-surface-overlay"
            onClick={() => useAppStore.getState().setWorkspaceSwitchError(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
