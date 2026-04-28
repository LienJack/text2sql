"use client";

import type { Datasource, GlossaryScope, GlossaryTerm, UpsertGlossaryTermResponse } from "@text2sql/shared-types";
import { BookOpen, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { listDatasources } from "@/lib/api-client";
import {
  AdminApiError,
  createGlossaryTerm,
  listGlossaryTerms,
  toggleGlossaryTerm,
  updateGlossaryTerm
} from "@/lib/admin-api-client";

type GlossaryFormState = {
  term: string;
  synonyms: string;
  definition: string;
  scope: GlossaryScope;
  datasourceId: string;
  priority: string;
};

type OperationNotice = {
  variant: "success" | "idle";
  text: string;
  termId?: string;
};

const DEFAULT_FORM_STATE: GlossaryFormState = {
  term: "",
  synonyms: "",
  definition: "",
  scope: "global",
  datasourceId: "",
  priority: "50"
};

function createIdempotencyKey(action: string): string {
  return `glossary-${action}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveWriteError(error: unknown): string {
  if (error instanceof AdminApiError && error.code === "FORBIDDEN") {
    return "当前账号没有术语写权限（仅管理员可执行写操作）。";
  }
  return error instanceof Error ? error.message : "术语写入失败";
}

function parseSynonyms(value: string): string[] {
  const deduped = new Set<string>();
  for (const item of value.split(/[,\n，]/)) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function parsePriority(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function sortTerms(items: GlossaryTerm[]): GlossaryTerm[] {
  return [...items].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    const updatedAtDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (updatedAtDiff !== 0) {
      return updatedAtDiff;
    }
    return left.term.localeCompare(right.term);
  });
}

function buildOperationNotice(
  action: string,
  response: UpsertGlossaryTermResponse
): OperationNotice {
  const parts: string[] = [action];
  const decision = response.conflictDecision;

  if (response.term.scope === "datasource") {
    parts.push("作用域规则：同名术语下，数据源作用域优先于全局。");
  }

  if (decision) {
    if (decision.winnerTermId === response.term.id) {
      parts.push(
        decision.loserTermIds.length > 0
          ? `冲突裁决：当前术语胜出，覆盖 ${decision.loserTermIds.length} 个候选。`
          : "冲突裁决：当前术语为唯一候选。"
      );
    } else {
      parts.push(`冲突裁决：当前术语未胜出，生效术语 ID 为 ${decision.winnerTermId}。`);
    }
  }

  if (response.linkageStatus === "degraded") {
    parts.push("联动降级：术语已保存，RAG 联动当前处于降级状态。");
  } else if (response.linkageStatus === "error") {
    parts.push("联动异常：术语已保存，但语义联动返回异常。");
  } else if (response.linkageStatus === "empty") {
    parts.push("联动提示：当前写入未命中可联动内容。");
  }

  return {
    variant: response.linkageStatus === "success" ? "success" : "idle",
    text: parts.join(" "),
    termId: response.term.id
  };
}

function scopeLabel(term: GlossaryTerm, datasourceMap: Map<string, string>): string {
  if (term.scope === "global") {
    return "全局";
  }
  const datasourceId = term.datasourceId ?? "";
  return datasourceMap.get(datasourceId) ?? (datasourceId || "数据源");
}

export default function GlossaryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [datasourceLoadError, setDatasourceLoadError] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [formState, setFormState] = useState<GlossaryFormState>(DEFAULT_FORM_STATE);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toggleLoadingTermId, setToggleLoadingTermId] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<OperationNotice | null>(null);

  const datasourceMap = useMemo(
    () =>
      new Map(
        datasources.map((item) => [item.id, item.name] as const)
      ),
    [datasources]
  );

  const loadTerms = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const data = await listGlossaryTerms({
        page: 1,
        pageSize: 100
      });
      setTerms(sortTerms(data.items));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载术语库失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const [termResult, datasourceResult] = await Promise.allSettled([
          listGlossaryTerms({
            page: 1,
            pageSize: 100
          }),
          listDatasources({
            includeUnavailable: true
          })
        ]);
        if (!active) {
          return;
        }

        if (termResult.status === "fulfilled") {
          setTerms(sortTerms(termResult.value.items));
          setError("");
        } else {
          setTerms([]);
          setError(
            termResult.reason instanceof Error
              ? termResult.reason.message
              : "加载术语库失败"
          );
        }

        if (datasourceResult.status === "fulfilled") {
          setDatasources(datasourceResult.value);
          setDatasourceLoadError("");
        } else {
          setDatasources([]);
          setDatasourceLoadError("数据源列表加载失败，数据源范围需要手动填写。");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const isEditing = editingTermId !== null;

  const filteredTerms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return terms;
    }
    return terms.filter((term) =>
      `${term.term} ${term.synonyms.join(" ")} ${term.definition} ${scopeLabel(term, datasourceMap)}`
        .toLowerCase()
        .includes(keyword)
    );
  }, [datasourceMap, query, terms]);

  const openCreateDrawer = () => {
    setEditingTermId(null);
    setFormError("");
    setFormState(DEFAULT_FORM_STATE);
    setDrawerOpen(true);
  };

  const openEditDrawer = (term: GlossaryTerm) => {
    setEditingTermId(term.id);
    setFormError("");
    setFormState({
      term: term.term,
      synonyms: term.synonyms.join(", "),
      definition: term.definition,
      scope: term.scope,
      datasourceId: term.datasourceId ?? "",
      priority: String(term.priority)
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setFormError("");
  };

  const submitForm = async () => {
    const normalizedTerm = formState.term.trim();
    const normalizedDefinition = formState.definition.trim();
    const normalizedDatasourceId = formState.datasourceId.trim();
    const priority = parsePriority(formState.priority);
    const synonyms = parseSynonyms(formState.synonyms);

    if (!normalizedTerm) {
      setFormError("请填写术语名称。");
      return;
    }
    if (!normalizedDefinition) {
      setFormError("请填写术语定义。");
      return;
    }
    if (formState.scope === "datasource" && !normalizedDatasourceId) {
      setFormError("选择数据源范围时必须指定 datasourceId。");
      return;
    }

    setFormSaving(true);
    setFormError("");
    try {
      const idempotencyKey = createIdempotencyKey(isEditing ? "update" : "create");
      const response = isEditing
        ? await updateGlossaryTerm(
            editingTermId!,
            {
              definition: normalizedDefinition,
              synonyms,
              priority
            },
            { idempotencyKey }
          )
        : await createGlossaryTerm(
            {
              term: normalizedTerm,
              definition: normalizedDefinition,
              synonyms,
              scope: formState.scope,
              datasourceId:
                formState.scope === "datasource" ? normalizedDatasourceId : undefined,
              priority
            },
            { idempotencyKey }
          );

      setOperationNotice(
        buildOperationNotice(isEditing ? "术语已更新。" : "术语已创建。", response)
      );
      await loadTerms();
      closeDrawer();
    } catch (saveError) {
      setFormError(resolveWriteError(saveError));
    } finally {
      setFormSaving(false);
    }
  };

  const handleToggleTerm = async (term: GlossaryTerm): Promise<void> => {
    setToggleLoadingTermId(term.id);
    setFormError("");
    try {
      const response = await toggleGlossaryTerm(term.id, {
        idempotencyKey: createIdempotencyKey("toggle")
      });
      setOperationNotice(buildOperationNotice("术语状态已更新。", response));
      await loadTerms();
    } catch (toggleError) {
      setFormError(resolveWriteError(toggleError));
    } finally {
      setToggleLoadingTermId(null);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 bg-[var(--surface-page)] p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">业务术语库</h2>
          <p className="text-sm text-[var(--text-secondary)]">统一业务术语和同义词，提高问数理解准确性。</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索术语或同义词"
            />
          </div>
          <Sheet
            open={drawerOpen}
            onOpenChange={(nextOpen) => {
              setDrawerOpen(nextOpen);
              if (!nextOpen) {
                setFormError("");
              }
            }}
          >
            <SheetTrigger asChild>
              <Button onClick={openCreateDrawer}>
                <Plus className="h-4 w-4" />
                新增术语
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>{isEditing ? "编辑术语" : "新增术语"}</SheetTitle>
                <SheetDescription>维护术语定义、作用范围和优先级。</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 py-6">
                <div className="space-y-2">
                  <label
                    htmlFor="glossary-term-input"
                    className="text-sm font-medium text-[var(--text-primary)]"
                  >
                    术语名称
                  </label>
                  <Input
                    id="glossary-term-input"
                    placeholder="例如：活跃用户(DAU)"
                    value={formState.term}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        term: event.target.value
                      }))
                    }
                    disabled={isEditing || formSaving}
                  />
                  {isEditing ? (
                    <p className="text-xs text-[var(--text-tertiary)]">
                      当前版本不支持修改术语名称；如需改名，请新建术语并停用旧术语。
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="glossary-synonyms-input"
                    className="text-sm font-medium text-[var(--text-primary)]"
                  >
                    同义词
                  </label>
                  <Input
                    id="glossary-synonyms-input"
                    placeholder="例如：日活, 每日活跃用户"
                    value={formState.synonyms}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        synonyms: event.target.value
                      }))
                    }
                    disabled={formSaving}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="glossary-definition-input"
                    className="text-sm font-medium text-[var(--text-primary)]"
                  >
                    定义
                  </label>
                  <textarea
                    id="glossary-definition-input"
                    className="h-28 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                    placeholder="输入业务定义或计算逻辑..."
                    value={formState.definition}
                    onChange={(event) =>
                      setFormState((previous) => ({
                        ...previous,
                        definition: event.target.value
                      }))
                    }
                    disabled={formSaving}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label
                      htmlFor="glossary-scope-select"
                      className="text-sm font-medium text-[var(--text-primary)]"
                    >
                      作用范围
                    </label>
                    <select
                      id="glossary-scope-select"
                      className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-70"
                      value={formState.scope}
                      onChange={(event) =>
                        setFormState((previous) => ({
                          ...previous,
                          scope: event.target.value === "datasource" ? "datasource" : "global",
                          datasourceId:
                            event.target.value === "datasource"
                              ? previous.datasourceId
                              : ""
                        }))
                      }
                      disabled={isEditing || formSaving}
                    >
                      <option value="global">全局</option>
                      <option value="datasource">数据源</option>
                    </select>
                    {isEditing ? (
                      <p className="text-xs text-[var(--text-tertiary)]">
                        当前版本不支持直接修改作用域；请通过新建术语调整作用域。
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="glossary-priority-input"
                      className="text-sm font-medium text-[var(--text-primary)]"
                    >
                      优先级（0-100）
                    </label>
                    <Input
                      id="glossary-priority-input"
                      type="number"
                      min={0}
                      max={100}
                      value={formState.priority}
                      onChange={(event) =>
                        setFormState((previous) => ({
                          ...previous,
                          priority: event.target.value
                        }))
                      }
                      disabled={formSaving}
                    />
                  </div>
                </div>

                {formState.scope === "datasource" ? (
                  <div className="space-y-2">
                    <label
                      htmlFor="glossary-datasource-select"
                      className="text-sm font-medium text-[var(--text-primary)]"
                    >
                      数据源范围
                    </label>
                    <select
                      id="glossary-datasource-select"
                      className="h-10 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-70"
                      value={formState.datasourceId}
                      onChange={(event) =>
                        setFormState((previous) => ({
                          ...previous,
                          datasourceId: event.target.value
                        }))
                      }
                      disabled={isEditing || formSaving}
                    >
                      <option value="">请选择数据源</option>
                      {datasources.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.id})
                        </option>
                      ))}
                    </select>
                    {datasourceLoadError ? (
                      <StateBlock variant="idle">{datasourceLoadError}</StateBlock>
                    ) : null}
                    {formState.scope === "datasource" && datasources.length === 0 ? (
                      <Input
                        placeholder="手动输入 datasourceId"
                        value={formState.datasourceId}
                        onChange={(event) =>
                          setFormState((previous) => ({
                            ...previous,
                            datasourceId: event.target.value
                          }))
                        }
                        disabled={isEditing || formSaving}
                      />
                    ) : null}
                  </div>
                ) : null}

                {formError ? <StateBlock variant="error">{formError}</StateBlock> : null}
              </div>
              <SheetFooter>
                <Button variant="ghost" onClick={closeDrawer} disabled={formSaving}>
                  取消
                </Button>
                <Button onClick={() => void submitForm()} disabled={formSaving}>
                  {formSaving ? "保存中..." : "保存"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </section>

      {operationNotice ? (
        <StateBlock variant={operationNotice.variant}>{operationNotice.text}</StateBlock>
      ) : null}
      {formError && !drawerOpen ? (
        <StateBlock variant="error">{formError}</StateBlock>
      ) : null}

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        {loading ? <StateBlock variant="loading" className="m-4">正在加载术语数据...</StateBlock> : null}
        {error ? <StateBlock variant="error" className="m-4">{error}</StateBlock> : null}
        {!loading && !error && filteredTerms.length === 0 ? (
          <StateBlock variant="idle" className="m-4">暂无匹配术语。</StateBlock>
        ) : null}

        {!loading && !error && filteredTerms.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">术语</TableHead>
                <TableHead className="w-[280px]">同义词</TableHead>
                <TableHead>定义</TableHead>
                <TableHead className="w-[140px] text-center">范围</TableHead>
                <TableHead className="w-[90px] text-center">优先级</TableHead>
                <TableHead className="w-[100px] text-center">状态</TableHead>
                <TableHead className="w-[100px] text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTerms.map((term) => (
                <TableRow key={term.id}>
                  <TableCell>
                    <div className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <BookOpen className="h-4 w-4 text-[var(--action-primary)]" />
                      {term.term}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {term.synonyms.map((synonym) => (
                        <Badge key={synonym} variant="secondary">
                          {synonym}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[var(--text-secondary)]">
                    {term.definition}
                    {operationNotice?.termId === term.id ? (
                      <p className="mt-1 text-xs text-[var(--text-tertiary)]">已更新联动反馈。</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={term.scope === "global" ? "default" : "outline"}>
                      {scopeLabel(term, datasourceMap)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm text-[var(--text-secondary)]">
                    {term.priority}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={term.status === "active"}
                      onCheckedChange={() => void handleToggleTerm(term)}
                      disabled={toggleLoadingTermId === term.id || formSaving}
                      aria-label={`切换术语 ${term.term} 状态`}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDrawer(term)}
                      disabled={formSaving}
                    >
                      <Pencil className="h-4 w-4" />
                      编辑
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
