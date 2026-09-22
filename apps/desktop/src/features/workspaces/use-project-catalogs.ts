import { useCallback, useEffect, useRef, useState } from "react";
import { hostClient } from "../../lib/bridge/host-client";
import { hostContext } from "../../lib/bridge/host-context";
import { subscribeValidatedHostEvent } from "../../lib/bridge/validated-host-events";
import { useAppStore } from "../../lib/stores/app-store";
import { patchCatalogs, type SessionPatch } from "./project-catalog-events";
import { catalogEntries, type ProjectCatalogs } from "./project-catalog";

export function useProjectCatalogs(neededPaths: string[]) {
  const hostId = useAppStore((s) => s.host?.hostInstanceId);
  const recovering = useAppStore(
    (s) => s.connecting || s.rehydrating || s.desynchronized || !!s.hostFatal,
  );
  const currentCatalog = useAppStore((s) => s.sessionCatalog);
  const cwd = useAppStore((s) => s.workspace?.canonicalCwd);
  const [catalogs, setCatalogs] = useState<ProjectCatalogs>({});
  const requests = useRef(new Map<string, number>());
  const epoch = useRef(0);
  const previousNeeded = useRef(new Set<string>());
  const patches = useRef(new Map<string, SessionPatch>());
  const catalogsRef = useRef(catalogs);
  catalogsRef.current = catalogs;
  const inFlight = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const neededRef = useRef(neededPaths);
  neededRef.current = neededPaths;

  const refresh = useCallback(async (path: string) => {
    const state = useAppStore.getState();
    if (
      !state.host ||
      state.connecting ||
      state.rehydrating ||
      state.desynchronized ||
      state.hostFatal
    )
      return;
    if (inFlight.current.has(path)) {
      dirty.current.add(path);
      return;
    }
    inFlight.current.add(path);
    const generation = epoch.current;
    const request = (requests.current.get(path) ?? 0) + 1;
    requests.current.set(path, request);
    const expectedHost = state.host.hostInstanceId;
    const patchesAtStart = new Map(patches.current);
    setCatalogs((all) => ({
      ...all,
      [path]: {
        ...(all[path] ?? { canonicalCwd: path, items: [], loaded: false }),
        loading: true,
        error: undefined,
      },
    }));
    const isCurrent = () =>
      epoch.current === generation &&
      requests.current.get(path) === request &&
      useAppStore.getState().host?.hostInstanceId === expectedHost;
    try {
      const response = await hostClient.request(
        "session.listForWorkspace",
        hostContext(state.host),
        { cwd: path },
      );
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(response.error.message);
      const { canonicalCwd } = response.result;
      const items = response.result.items.map((item) => {
        const patch = patches.current.get(item.sessionId);
        if (patch && patch === patchesAtStart.get(item.sessionId)) {
          // A completed later read supersedes earlier metadata events. Runtime
          // errors are event-only: the SDK's idle snapshot cannot reconstruct them.
          if (patch.runtimeState === "error") {
            const errorPatch = { runtimeState: patch.runtimeState, lastError: patch.lastError };
            patches.current.set(item.sessionId, errorPatch);
            return { ...item, ...errorPatch };
          }
          patches.current.delete(item.sessionId);
          return item;
        }
        return { ...item, ...patch };
      });
      setCatalogs((all) => ({
        ...all,
        [path]: {
          canonicalCwd,
          items: catalogEntries(items),
          loaded: true,
          loading: false,
        },
      }));
      const current = useAppStore.getState();
      if (current.workspace?.canonicalCwd === canonicalCwd && !current.workspaceSwitchTarget) {
        current.replaceSessionCatalog(current.workspace.id, items);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setCatalogs((all) => ({
        ...all,
        [path]: {
          ...all[path]!,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    } finally {
      if (epoch.current === generation) {
        inFlight.current.delete(path);
        if (dirty.current.delete(path)) void refresh(path);
      }
    }
  }, []);

  useEffect(() => {
    epoch.current += 1;
    requests.current.clear();
    patches.current.clear();
    inFlight.current.clear();
    dirty.current.clear();
    previousNeeded.current.clear();
    catalogsRef.current = {};
    setCatalogs({});
    return () => {
      epoch.current += 1;
    };
  }, [hostId, recovering]);

  const neededKey = JSON.stringify(neededPaths);
  useEffect(() => {
    if (recovering) return;
    for (const path of neededRef.current) {
      if (!previousNeeded.current.has(path) || !catalogsRef.current[path]) void refresh(path);
    }
    previousNeeded.current = new Set(neededRef.current);
  }, [neededKey, hostId, recovering, refresh]);

  useEffect(() => {
    const onFocus = () => {
      for (const path of neededRef.current) void refresh(path);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!hostId) return;
    const scope = { expectedHostInstanceId: hostId };
    function projectFor(id: string) {
      const existing = Object.entries(catalogsRef.current).find(([, catalog]) =>
        catalog.items.some((item) => item.sessionId === id),
      );
      if (existing) return existing[0];
      const state = useAppStore.getState();
      return (
        state.transcriptDrafts[id]?.cwd ??
        (state.session?.sessionId === id ? state.workspace?.canonicalCwd : undefined)
      );
    }
    function apply(id: string, patch: SessionPatch) {
      patches.current.set(id, { ...patches.current.get(id), ...patch });
      setCatalogs((all) => patchCatalogs(all, id, patch));
    }
    const stops = [
      subscribeValidatedHostEvent("session.infoChanged", scope, ({ payload }) => {
        apply(payload.sessionId, { name: payload.name });
        const path = projectFor(payload.sessionId);
        if (path && !catalogsRef.current[path]?.loaded) void refresh(path);
      }),
      subscribeValidatedHostEvent("session.runtimeChanged", scope, ({ payload }) => {
        apply(payload.sessionId, {
          runtimeState: payload.state,
          lastError: payload.error,
          sessionRevision: payload.sessionRevision,
          ...(payload.state === "running" ? { updatedAt: payload.updatedAt } : {}),
        });
        const path = projectFor(payload.sessionId);
        if (path) void refresh(path);
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [hostId, refresh]);

  // The current catalog receives snapshots immediately, including before the first file is written.
  const projected = { ...catalogs };
  if (cwd && catalogs[cwd] && currentCatalog.workspaceId === useAppStore.getState().workspace?.id) {
    const entries = new Map(catalogs[cwd].items.map((item) => [item.sessionId, item]));
    for (const item of Object.values(currentCatalog.entries)) entries.set(item.sessionId, item);
    projected[cwd] = { ...catalogs[cwd], items: [...entries.values()] };
  }
  for (const [path, catalog] of Object.entries(projected)) {
    projected[path] = {
      ...catalog,
      items: catalog.items.map((item) => ({ ...item, ...patches.current.get(item.sessionId) })),
    };
  }
  return { catalogs: projected, refresh };
}
