import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import DataSourcesPage from "@/app/data-sources/page";
import DashboardsPage from "@/app/dashboards/page";
import GlossaryPage from "@/app/glossary/page";
import OverviewPage from "@/app/page";
import PromptsPage from "@/app/prompts/page";
import SettingsPage from "@/app/settings/page";

describe("platform pages smoke", () => {
  it("renders overview page", async () => {
    render(<OverviewPage />);
    expect(await screen.findByText("Text2SQL 平台总览")).toBeInTheDocument();
  });

  it("renders data sources page", async () => {
    render(<DataSourcesPage />);
    expect(await screen.findByRole("heading", { name: "业务核心库_MySQL" })).toBeInTheDocument();
  });

  it("renders dashboards page", async () => {
    render(<DashboardsPage />);
    expect(await screen.findByRole("heading", { name: "我的看板" })).toBeInTheDocument();
  });

  it("renders glossary page", async () => {
    render(<GlossaryPage />);
    expect(await screen.findByText("业务术语库")).toBeInTheDocument();
  });

  it("renders prompts page", async () => {
    render(<PromptsPage />);
    expect(await screen.findByText("自定义提示词模板")).toBeInTheDocument();
  });

  it("renders settings page", async () => {
    render(<SettingsPage />);
    expect(await screen.findByText("LLM 模型")).toBeInTheDocument();
  });
});
