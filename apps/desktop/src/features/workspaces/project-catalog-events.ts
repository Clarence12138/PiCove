import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";
import type { ProjectCatalogs } from "./project-catalog";

export type SessionPatch = Partial<
  Pick<SessionCatalogEntry, "name" | "runtimeState" | "lastError" | "sessionRevision" | "updatedAt">
>;
export function patchCatalogs(
  catalogs: ProjectCatalogs,
  id: string,
  patch: SessionPatch,
): ProjectCatalogs {
  return Object.fromEntries(
    Object.entries(catalogs).map(([cwd, catalog]) => [
      cwd,
      {
        ...catalog,
        items: catalog.items.map((item) => (item.sessionId === id ? { ...item, ...patch } : item)),
      },
    ]),
  );
}
