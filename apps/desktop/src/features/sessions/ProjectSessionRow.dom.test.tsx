/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuHost } from "../../components/Menu";
import { closeContextMenu } from "../../lib/context-menu";
import { useAppStore } from "../../lib/stores/app-store";
import { runProjectSessionAction } from "./project-session-actions";
import { ProjectSessionRow } from "./ProjectSessionRow";
import { readProjectPins } from "./project-session-pins";
import type { SessionCatalogEntry } from "../../lib/stores/session-catalog";

vi.mock("./project-session-actions", () => ({ runProjectSessionAction: vi.fn(async () => true) }));
vi.mock("../../lib/commands/workspace-navigation", () => ({
  navigateToSession: vi.fn(async () => true),
}));
const item: SessionCatalogEntry = {
  sessionId: "one",
  sessionPath: "/sessions/one",
  cwd: "/other",
  name: "A session",
  updatedAt: 1,
  messageCount: 1,
  runtimeState: "inactive",
};
function showRow() {
  render(
    <>
      <ul>
        <ProjectSessionRow item={item} cwd="/other" showProjectName onChanged={() => {}} />
      </ul>
      <MenuHost />
    </>,
  );
}
function menu() {
  fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
}
describe("project session row", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useAppStore.setState({
      host: { hostInstanceId: "host" } as never,
      workspace: { canonicalCwd: "/current" } as never,
      session: null,
      connecting: false,
      rehydrating: false,
      desynchronized: false,
      hostFatal: null,
      workspaceSwitchTarget: null,
      extensionUiRequest: null,
      extensionUiQueue: [],
    });
  });
  afterEach(() => {
    cleanup();
    closeContextMenu();
  });
  it("shows project attribution and cancels rename without switching or mutating", () => {
    showRow();
    expect(screen.getByText("other")).toBeVisible();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New name" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(runProjectSessionAction).not.toHaveBeenCalled();
  });
  it("does not submit IME Enter and submits the committed title explicitly", async () => {
    showRow();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "中文名称" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(runProjectSessionAction).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.click(screen.getByTitle("Save name"));
    await waitFor(() =>
      expect(runProjectSessionAction).toHaveBeenCalledWith({
        cwd: "/other",
        item,
        action: "rename",
        name: "中文名称",
      }),
    );
  });
  it("cancels deletion without switching workspace", () => {
    showRow();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(runProjectSessionAction).not.toHaveBeenCalled();
  });
  it("pins by project path without switching to the project", () => {
    showRow();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(readProjectPins("/other")).toEqual(["one"]);
    expect(runProjectSessionAction).not.toHaveBeenCalled();
  });
  it("keeps rename open when workspace action fails", async () => {
    vi.mocked(runProjectSessionAction).mockResolvedValueOnce(false);
    showRow();
    menu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Retry me" } });
    fireEvent.click(screen.getByTitle("Save name"));
    await waitFor(() => expect(runProjectSessionAction).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue("Retry me");
  });
});
