import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

let pathname = "/log";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { TabBar } from "@/components/ui/TabBar";

describe("TabBar", () => {
  afterEach(cleanup);

  it("marks the active tab with aria-current=page", () => {
    pathname = "/log";
    render(<TabBar />);
    expect(
      screen.getByRole("link", { name: "履歴" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "ホーム" }).getAttribute("aria-current")
    ).toBeNull();
  });

  it("treats nested routes as active", () => {
    pathname = "/settings/rules";
    render(<TabBar />);
    expect(
      screen.getByRole("link", { name: "設定" }).getAttribute("aria-current")
    ).toBe("page");
  });
});
