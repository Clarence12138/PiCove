import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarLayout } from "./Sidebar";
import type { NavPage } from "../lib/stores/app-store";

describe("Sidebar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each<NavPage>(["chat", "packages", "settings"])(
    "keeps the conversation workspace mounted on the %s page",
    (page) => {
      vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });

      const html = renderToStaticMarkup(createElement(SidebarLayout, { page, setPage: vi.fn() }));

      expect(html).toContain("New conversation");
      expect(html).toContain("Workspaces");
      expect(html).toContain("Recent conversations");
      expect(html).toContain("Settings");
      expect(html).toContain("data-sidebar-workspaces");
      expect(html).not.toContain("data-sidebar-split");
      expect(html).toContain("Collapse sidebar");
      expect(html).not.toContain("overflow-hidden border-r border-border bg-sidebar");
      expect(html).toContain("data-recent-sessions");
      expect(html).not.toContain(">Chat<");
      expect(html).not.toContain(">Packages<");
    },
  );

  it("ignores obsolete workspace pane height", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "pideck.sidebar.workspacePaneHeight" ? "180" : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(SidebarLayout, { page: "chat", setPage: vi.fn() }),
    );

    expect(html).not.toContain("height:180px");
    expect(html).not.toContain("max-h-[min(40%,15rem)]");
  });

  it("keeps only the hover edge control mounted when the sidebar is collapsed", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "pideck.sidebar.collapsed" ? "1" : null),
      setItem: vi.fn(),
    });

    const html = renderToStaticMarkup(
      createElement(SidebarLayout, { page: "chat", setPage: vi.fn() }),
    );

    expect(html).toContain('aria-label="Expand sidebar"');
    expect(html).toContain("margin-left:-268px");
    expect(html).not.toContain("New conversation");
    expect(html).not.toContain("Recent conversations");
  });
});
