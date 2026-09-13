/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SessionSnapshot } from "@pideck/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../lib/stores/app-store";
import { WorkspaceSwitchTransition } from "./WorkspaceSwitchTransition";

function renderConversation() {
  render(
    <WorkspaceSwitchTransition>
      <p>conversation</p>
    </WorkspaceSwitchTransition>,
  );
  return screen.getByText("conversation").parentElement!;
}

describe("WorkspaceSwitchTransition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      workspaceSwitchTarget: null,
      workspaceSwitchError: null,
      workspace: null,
      session: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders interactive content without a skeleton when idle", () => {
    const content = renderConversation();
    expect(screen.getByText("conversation")).toBeVisible();
    expect(content).not.toHaveAttribute("inert");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("immediately blocks interaction and delays the named skeleton by 180 ms", () => {
    const content = renderConversation();
    act(() => useAppStore.getState().setWorkspaceSwitchTarget("/Users/me/Projects/PiDeck"));
    expect(content).toHaveAttribute("inert");
    expect(content).toHaveAttribute("aria-hidden", "true");
    expect(content).toHaveClass("opacity-100");
    act(() => vi.advanceTimersByTime(179));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Opening PiDeck…");
    expect(content).toHaveClass("opacity-0");
  });

  it("avoids a loading flash when a brief switch finishes within the delay", () => {
    const content = renderConversation();
    act(() => useAppStore.getState().setWorkspaceSwitchTarget("/tmp/other"));
    act(() => vi.advanceTimersByTime(80));
    act(() => useAppStore.getState().setWorkspaceSwitchTarget(null));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(content).not.toHaveAttribute("inert");
    expect(content).toHaveClass("opacity-100");
  });

  it("keeps one continuous transition and updates its label for newer targets", () => {
    const content = renderConversation();
    act(() => useAppStore.getState().setWorkspaceSwitchTarget("/tmp/b"));
    act(() => vi.advanceTimersByTime(100));
    act(() => useAppStore.getState().setWorkspaceSwitchTarget("/tmp/c"));
    act(() => vi.advanceTimersByTime(80));
    const skeleton = screen.getByRole("status");
    expect(skeleton).toHaveTextContent("Opening c…");
    act(() => useAppStore.getState().setWorkspaceSwitchTarget("/tmp/d"));
    expect(screen.getByRole("status")).toBe(skeleton);
    expect(skeleton).toHaveTextContent("Opening d…");
    act(() => useAppStore.getState().setWorkspaceSwitchTarget(null));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(content).not.toHaveAttribute("aria-hidden");
    expect(content).not.toHaveAttribute("inert");
  });

  it.each(["workspace", "session"])(
    "immediately hides an intermediate %s even before the skeleton delay",
    (kind) => {
      const content = renderConversation();
      act(() => useAppStore.getState().setWorkspaceSwitchTarget("/tmp/d"));
      act(() => {
        if (kind === "workspace") {
          useAppStore.setState({
            workspace: {
              id: "intermediate",
              cwd: "/tmp/b",
              canonicalCwd: "/tmp/b",
              revision: 2,
              servicesReady: true,
            },
          });
        } else {
          useAppStore.setState({
            session: { sessionId: "intermediate", revision: 2 } as SessionSnapshot,
          });
        }
      });
      expect(content).toHaveStyle({ visibility: "hidden" });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      act(() => useAppStore.getState().setWorkspaceSwitchTarget(null));
      expect(content).not.toHaveStyle({ visibility: "hidden" });
    },
  );

  it("allows dismissing a failed navigation without changing the conversation", () => {
    renderConversation();
    act(() =>
      useAppStore
        .getState()
        .setWorkspaceSwitchError({ target: { cwd: "/tmp/b" }, message: "Directory unavailable" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Directory unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("conversation")).toBeVisible();
  });
});
