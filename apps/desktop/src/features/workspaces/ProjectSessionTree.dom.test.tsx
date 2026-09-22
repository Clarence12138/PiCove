/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostStatusSnapshot, SessionSummary } from "@pideck/protocol";
import { hostClient } from "../../lib/bridge/host-client";
import { useAppStore } from "../../lib/stores/app-store";
import { publishValidatedHostEvent } from "../../lib/bridge/validated-host-events";
import { ProjectSessionTree } from "./ProjectSessionTree";

const initial = useAppStore.getState();
const { navigate, create, persist } = vi.hoisted(() => ({
  navigate: vi.fn(),
  create: vi.fn(),
  persist: vi.fn(),
}));
vi.mock("../../lib/commands/workspace-navigation", () => ({
  navigateToSession: navigate,
  createSessionInWorkspace: create,
  switchWorkspace: vi.fn(),
  withWorkspaceForAction: vi.fn(),
}));
vi.mock("../../lib/desktop-settings", () => ({
  persistDesktopSettings: persist,
  notifyDesktopSettingsSaveFailure: vi.fn(),
}));

const HOST = "11111111-1111-4111-8111-111111111111";
function items(cwd: string, count = 7): SessionSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `${cwd}-${index}`,
    sessionPath: `${cwd}/${index}.jsonl`,
    cwd,
    name: `${cwd.slice(1)} conversation ${index}`,
    updatedAt: 100 - index,
    messageCount: 2,
  }));
}
function section(container: HTMLElement, cwd: string) {
  return container.querySelector(`[data-project-cwd="${cwd}"]`) as HTMLElement;
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  navigate.mockResolvedValue(true);
  create.mockResolvedValue(true);
  persist.mockResolvedValue(undefined);
  useAppStore.setState(
    {
      ...initial,
      host: { hostInstanceId: HOST, phase: "ready" } as HostStatusSnapshot,
      workspace: {
        id: "wa",
        cwd: "/alpha",
        canonicalCwd: "/alpha",
        revision: 1,
        servicesReady: true,
      },
      desktopSettings: { ...initial.desktopSettings!, knownWorkspaces: ["/alpha", "/beta"] },
      connecting: false,
      rehydrating: false,
      desynchronized: false,
      hostFatal: null,
    },
    true,
  );
  vi.spyOn(hostClient, "request").mockImplementation(async (method, _context, params) => {
    if (method !== "session.listForWorkspace") throw new Error(`Unexpected ${method}`);
    const cwd = (params as { cwd: string }).cwd;
    return { ok: true, result: { canonicalCwd: cwd, items: items(cwd) } } as never;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState(initial, true);
});

describe("project session tree", () => {
  it("only expands rows, keeps recent last and collapsed, and previews five sessions", async () => {
    const { container } = render(<ProjectSessionTree />);
    const alpha = within(section(container, "/alpha"));
    await waitFor(() => expect(alpha.getByText("alpha conversation 0")).toBeVisible());
    expect(alpha.queryByText("alpha conversation 5")).not.toBeInTheDocument();
    const recent = screen.getByRole("button", { name: "Recent conversations" });
    expect(recent).toHaveAttribute("aria-expanded", "false");
    const betaSection = section(container, "/beta");
    const recentSection = container.querySelector("[data-recent-sessions]")!;
    expect(
      betaSection.compareDocumentPosition(recentSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    await waitFor(() => expect(within(betaSection).getByText("beta conversation 0")).toBeVisible());
    expect(navigate).not.toHaveBeenCalled();
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/alpha");
    fireEvent.click(alpha.getByRole("button", { name: "Show more" }));
    expect(alpha.getByText("alpha conversation 6")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(alpha.queryByText("alpha conversation 6")).not.toBeInTheDocument();
  });

  it("aggregates collapsed projects, labels origins, and remembers recent collapse", async () => {
    const { container, unmount } = render(<ProjectSessionTree />);
    fireEvent.click(screen.getByRole("button", { name: "Recent conversations" }));
    const recent = within(container.querySelector("[data-recent-sessions]") as HTMLElement);
    await waitFor(() => expect(recent.getByText("beta conversation 0")).toBeVisible());
    expect(screen.getByRole("button", { name: "beta" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(recent.getByRole("button", { name: "beta conversation 0 beta" }));
    expect(navigate).toHaveBeenCalledWith({ cwd: "/beta", sessionPath: "/beta/0.jsonl" });
    fireEvent.click(screen.getByRole("button", { name: "Recent conversations" }));
    expect(recent.queryByText("beta conversation 0")).not.toBeInTheDocument();
    unmount();
    render(<ProjectSessionTree />);
    expect(screen.getByRole("button", { name: "Recent conversations" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("exposes partial failures and retries without changing the active workspace", async () => {
    let fails = true;
    vi.mocked(hostClient.request).mockImplementation(async (_method, _context, params) => {
      const cwd = (params as { cwd: string }).cwd;
      if (cwd === "/beta" && fails) throw new Error("Unreadable beta");
      return { ok: true, result: { canonicalCwd: cwd, items: items(cwd) } } as never;
    });
    render(<ProjectSessionTree />);
    fireEvent.click(screen.getByRole("button", { name: "Recent conversations" }));
    await screen.findByText(
      "Some projects could not be read. Recent conversations are incomplete.",
    );
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(useAppStore.getState().workspace?.canonicalCwd).toBe("/alpha");
  });

  it("refreshes background status and both copies on a validated event", async () => {
    let running = false;
    vi.mocked(hostClient.request).mockImplementation(async (_method, _context, params) => {
      const cwd = (params as { cwd: string }).cwd;
      return {
        ok: true,
        result: {
          canonicalCwd: cwd,
          items: items(cwd, 1).map((item) => ({
            ...item,
            runtimeState: running ? "running" : "inactive",
          })),
        },
      } as never;
    });
    const { container } = render(<ProjectSessionTree />);
    fireEvent.click(screen.getByRole("button", { name: "beta" }));
    fireEvent.click(screen.getByRole("button", { name: "Recent conversations" }));
    await waitFor(() => expect(screen.getAllByText("beta conversation 0")).toHaveLength(2));
    running = true;
    act(() =>
      publishValidatedHostEvent({
        event: "session.runtimeChanged",
        hostInstanceId: HOST,
        payload: { sessionId: "/beta-0", state: "running", updatedAt: 200, sessionRevision: 1 },
      } as never),
    );
    await waitFor(() =>
      expect(within(section(container, "/beta")).getByLabelText("running")).toBeVisible(),
    );
    expect(
      within(container.querySelector("[data-recent-sessions]") as HTMLElement).getAllByLabelText(
        "running",
      ),
    ).toHaveLength(1);
  });
});

it("keeps a folded project's error after a list reports idle and refreshes only that project", async () => {
  const { container } = render(<ProjectSessionTree />);
  fireEvent.click(screen.getByRole("button", { name: "beta" }));
  await waitFor(() => expect(screen.getByText("beta conversation 0")).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "beta" }));
  vi.mocked(hostClient.request).mockClear();
  act(() =>
    publishValidatedHostEvent({
      event: "session.runtimeChanged",
      hostInstanceId: HOST,
      payload: {
        sessionId: "/beta-0",
        state: "error",
        error: "Model request failed",
        updatedAt: 200,
        sessionRevision: 1,
      },
    } as never),
  );
  await waitFor(() => expect(hostClient.request).toHaveBeenCalledTimes(1));
  expect(hostClient.request).toHaveBeenCalledWith("session.listForWorkspace", expect.anything(), {
    cwd: "/beta",
  });
  fireEvent.click(screen.getByRole("button", { name: "beta" }));
  await waitFor(() =>
    expect(within(section(container, "/beta")).getByLabelText("error")).toBeVisible(),
  );
  expect(
    within(section(container, "/beta")).getByTitle("beta conversation 0 — Model request failed"),
  ).toBeVisible();
});

it("ignores responses from the previous host and refetches after reconnect", async () => {
  let resolveOld!: (value: never) => void;
  vi.mocked(hostClient.request).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  render(<ProjectSessionTree />);
  await waitFor(() => expect(hostClient.request).toHaveBeenCalledTimes(1));
  act(() =>
    useAppStore.setState({ host: { ...useAppStore.getState().host!, hostInstanceId: "new-host" } }),
  );
  await screen.findByText("alpha conversation 0");
  await act(async () =>
    resolveOld({
      ok: true,
      result: {
        canonicalCwd: "/alpha",
        items: [{ ...items("/alpha")[0], name: "Stale host title" }],
      },
    } as never),
  );
  expect(screen.queryByText("Stale host title")).not.toBeInTheDocument();
  expect(screen.getByText("alpha conversation 0")).toBeVisible();
});

it("accepts a later disk rename after an earlier title event", async () => {
  let title = "First title";
  vi.mocked(hostClient.request).mockImplementation(async (_method, _context, params) => {
    const cwd = (params as { cwd: string }).cwd;
    return {
      ok: true,
      result: { canonicalCwd: cwd, items: [{ ...items(cwd)[0], name: title }] },
    } as never;
  });
  render(<ProjectSessionTree />);
  await screen.findByText("First title");
  act(() =>
    publishValidatedHostEvent({
      event: "session.infoChanged",
      hostInstanceId: HOST,
      payload: { sessionId: "/alpha-0", name: "Event title" },
    } as never),
  );
  expect(screen.getByText("Event title")).toBeVisible();
  title = "Later disk title";
  fireEvent.focus(window);
  await screen.findByText("Later disk title");
  expect(screen.queryByText("Event title")).not.toBeInTheDocument();
});

it("reveals ten more project sessions per click and resets to five after collapsing", async () => {
  vi.mocked(hostClient.request).mockImplementation(async (_method, _context, params) => {
    const cwd = (params as { cwd: string }).cwd;
    return { ok: true, result: { canonicalCwd: cwd, items: items(cwd, 27) } } as never;
  });
  const { container } = render(<ProjectSessionTree />);
  const alpha = within(section(container, "/alpha"));
  await waitFor(() => expect(alpha.getAllByRole("listitem")).toHaveLength(5));
  fireEvent.click(alpha.getByRole("button", { name: "Show more" }));
  expect(alpha.getAllByRole("listitem")).toHaveLength(15);
  fireEvent.click(alpha.getByRole("button", { name: "Show more" }));
  expect(alpha.getAllByRole("listitem")).toHaveLength(25);
  fireEvent.click(alpha.getByRole("button", { name: "Show more" }));
  expect(alpha.getAllByRole("listitem")).toHaveLength(27);
  expect(alpha.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "alpha" }));
  expect(alpha.getAllByRole("listitem")).toHaveLength(5);
});
