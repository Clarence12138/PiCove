import { readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { stripAttachmentReferenceBlocks, type SessionSummary } from "@pideck/protocol";
import type { WorkspaceGraphFactory } from "./workspace-graph-factory.js";
import { sessionStorageDirs } from "./session-storage.js";
import { collectStartedLiveSessions, mergeStartedLiveSessions } from "./session-lifecycle.js";

// The SDK treats missing storage as empty, but also swallows directory/read
// errors. Check readability first so sidebar failures remain visible.
async function checkStorageReadable(directory: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    files
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => access(join(directory, file), constants.R_OK)),
  );
}

export async function listWorkspaceSessions(
  factory: WorkspaceGraphFactory,
  cwd: string,
): Promise<{
  canonicalCwd: string;
  items: SessionSummary[];
}> {
  const canonicalCwd = factory.canonicalizeCwd(cwd);
  const dirs = sessionStorageDirs(factory.deps.agentDir, canonicalCwd);
  const groups = await Promise.all(
    [false, true].map(async (archived) => {
      const directory = archived ? dirs.archiveDir : dirs.activeDir;
      await checkStorageReadable(directory);
      const sessions = await SessionManager.list(canonicalCwd, directory);
      return sessions.map((session) => ({ ...session, archived }));
    }),
  );
  // Resolve after disk IO: a workspace switch may have parked/promoted this graph.
  const graph = factory.findWorkspaceGraph(canonicalCwd);
  const entries = mergeStartedLiveSessions(
    factory,
    groups.flat(),
    graph ? collectStartedLiveSessions(graph) : [],
  );
  const items = entries.map((session): SessionSummary => ({
    sessionId: session.id,
    sessionPath: session.path,
    name: session.name,
    firstMessage: stripAttachmentReferenceBlocks(session.firstMessage ?? ""),
    cwd: canonicalCwd,
    updatedAt: session.modified.getTime(),
    messageCount: session.messageCount,
    archived: session.archived,
    ...(graph ? factory.getSessionRuntimeInfo(session.id, session.path, graph) : {}),
  }));
  return { canonicalCwd, items };
}
