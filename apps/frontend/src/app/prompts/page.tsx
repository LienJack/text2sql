"use client";

import { Code2, LineChart, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AdminApiError,
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  type PromptTemplate,
  type PromptTemplateScene,
  type PromptTemplateScopeType,
  type PromptTemplateStatus,
  updatePromptTemplate
} from "@/lib/admin-api-client";
import { cn } from "@/lib/utils";

type SceneFilter = "all" | PromptTemplateScene;

type PromptTemplateFormState = {
  name: string;
  scene: PromptTemplateScene;
  scopeType: PromptTemplateScopeType;
  scopeId: string;
  status: PromptTemplateStatus;
  content: string;
};

const DEFAULT_FORM_STATE: PromptTemplateFormState = {
  name: "",
  scene: "sql",
  scopeType: "global",
  scopeId: "",
  status: "active",
  content: ""
};

function resolvePromptMutationError(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.code === "FORBIDDEN") {
      return "当前账号没有模板写权限（仅管理员可执行写操作）。";
    }
    if (error.code === "CONFLICT") {
      return "当前作用域下已存在同名模板，请修改名称后重试。";
    }
    if (
      error.code === "INTERNAL_ERROR" ||
      error.code === "INTERNAL_SERVER_ERROR"
    ) {
      return "服务暂时不可用，请稍后重试。";
    }
  }
  return error instanceof Error ? error.message : "模板操作失败，请稍后重试。";
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}

export default function PromptsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [scene, setScene] = useState<SceneFilter>("all");
  const [query, setQuery] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [formState, setFormState] = useState<PromptTemplateFormState>(DEFAULT_FORM_STATE);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);

  const loadTemplates = useCallback(async (): Promise<void> => {
    const currentSequence = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const data = await listPromptTemplates({
        page: 1,
        pageSize: 100
      });
      if (currentSequence !== loadSequenceRef.current) {
        return;
      }
      setTemplates(data.items);
    } catch (loadError) {
      if (currentSequence !== loadSequenceRef.current) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "加载提示词模板失败");
      setTemplates([]);
    } finally {
      if (currentSequence === loadSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const filteredTemplates = useMemo(() => {
    const byScene =
      scene === "all" ? templates : templates.filter((template) => template.scene === scene);
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return byScene;
    }
    return byScene.filter((template) =>
      `${template.name} ${template.scopeLabel} v${template.version} ${template.content}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [query, scene, templates]);

  const isEditing = editingTemplateId !== null;

  const openCreateDialog = () => {
    setEditingTemplateId(null);
    setFormState(DEFAULT_FORM_STATE);
    setFormError("");
    setDialogOpen(true);
  };

  const openEditDialog = (template: PromptTemplate) => {
    setEditingTemplateId(template.id);
    setFormState({
      name: template.name,
      scene: template.scene,
      scopeType: template.scopeType,
      scopeId: template.scopeId ?? "",
      status: template.status,
      content: template.content
    });
    setFormError("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setFormError("");
  };

  const submitForm = async (): Promise<void> => {
    const normalizedName = formState.name.trim();
    const normalizedContent = formState.content.trim();
    const normalizedScopeId = formState.scopeId.trim();

    if (!normalizedName) {
      setFormError("请填写模板名称。");
      return;
    }
    if (!normalizedContent) {
      setFormError("请填写模板内容。");
      return;
    }
    if (formState.scopeType !== "global" && !normalizedScopeId) {
      setFormError("选择工作空间/数据源作用域时必须填写 scopeId。");
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      const payload = {
        name: normalizedName,
        scene: formState.scene,
        scopeType: formState.scopeType,
        scopeId: formState.scopeType === "global" ? undefined : normalizedScopeId,
        status: formState.status,
        content: normalizedContent
      } as const;
      if (isEditing) {
        if (!editingTemplateId) {
          setFormError("模板编辑状态异常，请关闭后重试。");
          return;
        }
        await updatePromptTemplate(editingTemplateId, payload);
      } else {
        await createPromptTemplate(payload);
      }
      setOperationMessage(isEditing ? "模板已更新。" : "模板已创建。");
      closeDialog();
      await loadTemplates();
    } catch (submitError) {
      setFormError(resolvePromptMutationError(submitError));
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (template: PromptTemplate): Promise<void> => {
    setDeletingTemplateId(template.id);
    setFormError("");
    try {
      await deletePromptTemplate(template.id);
      setOperationMessage("模板已删除。");
      await loadTemplates();
    } catch (deleteError) {
      setFormError(resolvePromptMutationError(deleteError));
    } finally {
      setDeletingTemplateId(null);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 bg-[var(--surface-page)] p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
            <Sparkles className="h-5 w-5 text-[var(--action-primary)]" />
            自定义提示词模板
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">按场景维护 Prompt 模板并进行版本化管理。</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          新增模板
        </Button>
      </section>

      {operationMessage ? (
        <StateBlock variant="success">{operationMessage}</StateBlock>
      ) : null}
      {formError && !dialogOpen ? (
        <StateBlock variant="error">{formError}</StateBlock>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        <div className="space-y-3 border-b border-[var(--border-default)] p-4 sm:flex sm:items-center sm:justify-between sm:space-y-0">
          <Tabs
            value={scene}
            onValueChange={(value) => setScene(value as SceneFilter)}
            className="w-full sm:w-auto"
          >
            <TabsList className="h-10">
              <TabsTrigger value="all">全部场景</TabsTrigger>
              <TabsTrigger value="sql">
                <Code2 className="h-3.5 w-3.5" />
                生成 SQL
              </TabsTrigger>
              <TabsTrigger value="analysis">
                <LineChart className="h-3.5 w-3.5" />
                分析总结
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索模板名称..."
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? <StateBlock variant="loading" className="m-4">正在加载模板...</StateBlock> : null}
          {error ? <StateBlock variant="error" className="m-4">{error}</StateBlock> : null}
          {!loading && !error && filteredTemplates.length === 0 ? (
            <StateBlock variant="idle" className="m-4">当前筛选条件下暂无模板。</StateBlock>
          ) : null}

          {!loading && !error && filteredTemplates.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[240px]">模板名称</TableHead>
                  <TableHead className="w-[120px]">场景</TableHead>
                  <TableHead className="w-[180px]">作用范围</TableHead>
                  <TableHead className="w-[100px]">版本</TableHead>
                  <TableHead className="w-[110px]">状态</TableHead>
                  <TableHead className="w-[150px]">更新时间</TableHead>
                  <TableHead className="w-[160px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTemplates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {template.scene === "sql" ? "生成 SQL" : "分析总结"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-secondary)]">{template.scopeLabel}</TableCell>
                    <TableCell className="font-mono text-sm text-[var(--text-secondary)]">
                      v{template.version}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          template.status === "active"
                            ? "text-emerald-600"
                            : "text-[var(--text-tertiary)]"
                        )}
                      >
                        {template.status === "active" ? "生效中" : "草稿"}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-tertiary)]">
                      {formatDate(template.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(template)}
                          aria-label={`编辑模板 ${template.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deletingTemplateId === template.id}
                          onClick={() => void handleDelete(template)}
                          aria-label={`删除模板 ${template.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                          {deletingTemplateId === template.id ? "删除中..." : "删除"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setFormError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? "编辑模板" : "新增模板"}</DialogTitle>
            <DialogDescription>维护模板场景、作用范围和内容。</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label htmlFor="prompt-template-name" className="text-sm font-medium text-[var(--text-primary)]">
                模板名称
              </label>
              <Input
                id="prompt-template-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    name: event.target.value
                  }))
                }
                disabled={formSaving}
                placeholder="例如：MySQL 分析增强模板"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="prompt-template-scene" className="text-sm font-medium text-[var(--text-primary)]">
                  场景
                </label>
                <select
                  id="prompt-template-scene"
                  className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                  value={formState.scene}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      scene: event.target.value === "analysis" ? "analysis" : "sql"
                    }))
                  }
                  disabled={formSaving}
                >
                  <option value="sql">生成 SQL</option>
                  <option value="analysis">分析总结</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="prompt-template-scope" className="text-sm font-medium text-[var(--text-primary)]">
                  作用范围
                </label>
                <select
                  id="prompt-template-scope"
                  className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                  value={formState.scopeType}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      scopeType:
                        event.target.value === "workspace" || event.target.value === "datasource"
                          ? event.target.value
                          : "global",
                      scopeId: event.target.value === "global" ? "" : previous.scopeId
                    }))
                  }
                  disabled={formSaving}
                >
                  <option value="global">全局</option>
                  <option value="workspace">工作空间</option>
                  <option value="datasource">数据源</option>
                </select>
              </div>

              <div className="space-y-2">
                <label htmlFor="prompt-template-status" className="text-sm font-medium text-[var(--text-primary)]">
                  状态
                </label>
                <select
                  id="prompt-template-status"
                  className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                  value={formState.status}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      status: event.target.value === "draft" ? "draft" : "active"
                    }))
                  }
                  disabled={formSaving}
                >
                  <option value="active">生效中</option>
                  <option value="draft">草稿</option>
                </select>
              </div>
            </div>

            {formState.scopeType !== "global" ? (
              <div className="space-y-2">
                <label htmlFor="prompt-template-scope-id" className="text-sm font-medium text-[var(--text-primary)]">
                  scopeId
                </label>
                <Input
                  id="prompt-template-scope-id"
                  value={formState.scopeId}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      scopeId: event.target.value
                    }))
                  }
                  disabled={formSaving}
                  placeholder={
                    formState.scopeType === "workspace"
                      ? "例如：workspace_default"
                      : "例如：datasource_sales"
                  }
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="prompt-template-content" className="text-sm font-medium text-[var(--text-primary)]">
                模板内容
              </label>
              <textarea
                id="prompt-template-content"
                className="h-36 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                value={formState.content}
                onChange={(event) =>
                  setFormState((previous) => ({
                    ...previous,
                    content: event.target.value
                  }))
                }
                disabled={formSaving}
                placeholder="输入模板正文..."
              />
            </div>

            {formError ? <StateBlock variant="error">{formError}</StateBlock> : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog} disabled={formSaving}>
              取消
            </Button>
            <Button onClick={() => void submitForm()} disabled={formSaving}>
              {formSaving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
