"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";

export type MetadataTarget =
  | {
      kind: "model";
      id: string;
      title: string;
      technicalName: string;
      displayName?: string | null;
      description?: string | null;
    }
  | {
      kind: "view";
      id: string;
      title: string;
      technicalName: string;
      displayName?: string | null;
      description?: string | null;
    };

function normalizeText(value: string): string {
  return value.trim();
}

export function ModelingMetadataEditor(props: {
  target: MetadataTarget | null;
  busy?: boolean;
  onSave: (input: { displayName: string | null; description: string | null }) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { target, busy, onSave, onDirtyChange } = props;
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDisplayName(target?.displayName ?? "");
    setDescription(target?.description ?? "");
    setError("");
  }, [target?.id, target?.kind, target?.displayName, target?.description]);

  const dirty = useMemo(() => {
    if (!target) {
      return false;
    }
    const initialDisplayName = target.displayName ?? "";
    const initialDescription = target.description ?? "";
    return displayName !== initialDisplayName || description !== initialDescription;
  }, [displayName, description, target]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (!target) {
    return <StateBlock variant="idle">请选择 Model 或 View 后编辑 Metadata。</StateBlock>;
  }

  const save = async (): Promise<void> => {
    setSubmitting(true);
    setError("");
    try {
      const nextDisplayName = normalizeText(displayName);
      const nextDescription = normalizeText(description);
      await onSave({
        displayName: nextDisplayName ? nextDisplayName : null,
        description: nextDescription ? nextDescription : null
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 metadata 失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          {target.kind === "model" ? "Model Metadata" : "View Metadata"}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          技术名：{target.technicalName}
        </p>
      </div>

      <Input
        aria-label="显示名称"
        placeholder="请输入显示名称"
        value={displayName}
        onChange={(event) => {
          setDisplayName(event.target.value);
        }}
      />
      <Textarea
        aria-label="描述"
        placeholder="请输入业务描述"
        value={description}
        onChange={(event) => {
          setDescription(event.target.value);
        }}
      />

      {error ? <StateBlock variant="error">{error}</StateBlock> : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={busy || submitting || !dirty}>
          保存 Metadata
        </Button>
        <Button
          variant="outline"
          disabled={busy || submitting || !dirty}
          onClick={() => {
            setDisplayName(target.displayName ?? "");
            setDescription(target.description ?? "");
            setError("");
          }}
        >
          重置
        </Button>
      </div>
    </div>
  );
}
