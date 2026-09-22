import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateSuccessResult, type SessionSnapshot } from "@pideck/protocol";
import {
  WorkspaceGraphFactory,
  type GraphFactoryDeps,
  type WorkspaceGraph,
} from "./workspace-graph-factory.js";
import type { PiHostServer } from "./server.js";
import { listWorkspaceSessions } from "./workspace-session-catalog.js";
import { sessionStorageDirs } from "./session-storage.js";

const DISK_ID = "33333333-3333-4333-8333-333333333333";
const ARCHIVED_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_ID = "55555555-5555-4555-8555-555555555555";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pideck-sidebar-catalog-")));
  roots.push(root);
  const cwd = join(root, "project");
  mkdirSync(cwd);
  const agentDir = join(root, "agent");
  const factory = new WorkspaceGraphFactory({ agentDir } as GraphFactoryDeps);
  const dirs = sessionStorageDirs(agentDir, cwd);
  const foreground = { canonicalCwd: join(root, "other") } as WorkspaceGraph;
  factory.graph = foreground;
  const identity = { sessionId: "foreground", sessionRevision: 99 };
  factory.bindServer({ identity } as unknown as PiHostServer);
  return { root, cwd, dirs, factory, foreground, identity };
}

function writeSession(directory: string, cwd: string, id: string) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({ type: "session", version: 3, id, cwd, timestamp: "2026-01-01T00:00:00.000Z" })}\n`,
  );
  return path;
}

describe("workspace session catalog", () => {
  it("reads normal and archived sessions without changing or creating a workspace graph", async () => {
    const f = fixture();
    writeSession(f.dirs.activeDir, f.cwd, DISK_ID);
    writeSession(f.dirs.archiveDir, f.cwd, ARCHIVED_ID);
    const setCurrent = vi.spyOn(f.factory, "setCurrent");
    const result = await listWorkspaceSessions(f.factory, f.cwd);
    expect(result.canonicalCwd).toBe(f.cwd);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: DISK_ID, archived: false }),
        expect.objectContaining({ sessionId: ARCHIVED_ID, archived: true }),
      ]),
    );
    expect(validateSuccessResult("session.listForWorkspace", result).ok).toBe(true);
    expect(f.factory.getGraph()).toBe(f.foreground);
    expect(f.identity.sessionRevision).toBe(99);
    expect(setCurrent).not.toHaveBeenCalled();
    expect(f.factory.findWorkspaceGraph(f.cwd)).toBeNull();
  });

  it("includes unsaved retained live sessions and their own revision", async () => {
    const f = fixture();
    const snapshot = {
      sessionId: LIVE_ID,
      sessionPath: join(f.dirs.activeDir, `${LIVE_ID}.jsonl`),
      cwd: f.cwd,
      revision: 7,
      messages: [],
      isIdle: false,
    } as unknown as SessionSnapshot;
    const retained = {
      canonicalCwd: f.cwd,
      sessionSnapshot: snapshot,
      agentSession: { isIdle: false },
      backgroundSessions: new Map(),
    } as unknown as WorkspaceGraph;
    const lifecycle = Reflect.get(f.factory, "workspaceLifecycle");
    Reflect.get(lifecycle, "retainedGraphs").set(f.cwd, retained);
    const result = await listWorkspaceSessions(f.factory, f.cwd);
    expect(result.items).toEqual([
      expect.objectContaining({ sessionId: LIVE_ID, runtimeState: "running", sessionRevision: 7 }),
    ]);
    expect(f.factory.getGraph()).toBe(f.foreground);
    expect(f.factory.findWorkspaceGraph(f.cwd)).toBe(retained);
  });

  it("canonicalizes symlinks and leaves empty projects without session storage", async () => {
    const f = fixture();
    const alias = join(f.root, "alias");
    symlinkSync(f.cwd, alias);
    expect(await listWorkspaceSessions(f.factory, alias)).toEqual({
      canonicalCwd: f.cwd,
      items: [],
    });
  });

  it("exposes invalid project and unreadable storage errors", async () => {
    const f = fixture();
    await expect(listWorkspaceSessions(f.factory, join(f.root, "missing"))).rejects.toMatchObject({
      code: "WORKSPACE_SWITCH_FAILED",
    });
    mkdirSync(join(f.dirs.activeDir, ".."), { recursive: true });
    writeFileSync(f.dirs.activeDir, "not a directory");
    await expect(listWorkspaceSessions(f.factory, f.cwd)).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });
});
