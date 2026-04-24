"use client";

import type {
  WorkspaceRelationshipDraft,
  WorkspaceRelationshipPublishPrecheck
} from "@/lib/admin-api-client";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";

export function RelationshipPublishPanel(props: {
  draft: WorkspaceRelationshipDraft | null;
  activeRevision?: number;
  precheck?: WorkspaceRelationshipPublishPrecheck | null;
  busy: boolean;
  onPrecheck: () => void;
  onPublish: () => void;
  onRollback: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-default)] bg-white/90 p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">发布门禁</p>
        <p className="text-xs text-[var(--text-secondary)]">
          发布前会检查 policyVersion、一致性预检，并走 dry-run fail-closed 验证。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
        <div>Draft Revision: {props.draft?.revision ?? "-"}</div>
        <div>Active Revision: {props.activeRevision ?? "-"}</div>
        <div>Policy Version: {props.draft?.policyVersion ?? "-"}</div>
        <div>Edge Count: {props.draft?.edges.length ?? 0}</div>
      </div>

      {props.precheck ? (
        props.precheck.publish_precheck_passed ? (
          <StateBlock variant="success">预检通过，可发布当前 draft。</StateBlock>
        ) : (
          <StateBlock variant="error">
            预检失败：{props.precheck.blockingReasons.join(", ") || "unknown"}
          </StateBlock>
        )
      ) : (
        <StateBlock variant="idle">尚未执行发布预检。</StateBlock>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={props.onPrecheck}
          disabled={props.busy || !props.draft}
        >
          发布预检
        </Button>
        <Button onClick={props.onPublish} disabled={props.busy || !props.draft}>
          发布 Active
        </Button>
        <Button
          variant="secondary"
          onClick={props.onRollback}
          disabled={props.busy || !props.draft || props.activeRevision === undefined}
        >
          回滚到当前 Draft
        </Button>
      </div>
    </div>
  );
}
