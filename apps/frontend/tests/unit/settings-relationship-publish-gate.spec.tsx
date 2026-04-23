import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RelationshipPublishPanel } from "@/components/settings/relationship-publish-panel";

describe("RelationshipPublishPanel", () => {
  it("shows precheck failure and triggers panel actions", async () => {
    const user = userEvent.setup();
    const onPrecheck = vi.fn();
    const onPublish = vi.fn();
    const onRollback = vi.fn();

    render(
      <RelationshipPublishPanel
        draft={{
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          policyVersion: 5,
          revision: 2,
          graphHash: "hash-1",
          edges: [],
          updatedAt: "2026-04-22T00:00:00.000Z"
        }}
        activeRevision={1}
        precheck={{
          workspaceId: "ws-1",
          datasourceId: "ds-1",
          draftRevision: 2,
          publish_precheck_passed: false,
          blockingReasons: ["policy_version_conflict"],
          policyVersion: 5
        }}
        busy={false}
        onPrecheck={onPrecheck}
        onPublish={onPublish}
        onRollback={onRollback}
      />
    );

    expect(screen.getByText(/预检失败/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "发布预检" }));
    await user.click(screen.getByRole("button", { name: "发布 Active" }));
    await user.click(screen.getByRole("button", { name: "回滚到当前 Draft" }));

    expect(onPrecheck).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledTimes(1);
  });
});
