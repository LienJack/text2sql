"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Datasource, DatasourceType } from "@text2sql/shared-types";
import {
  ArrowRight,
  Database,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  PlayCircle,
  Plus,
  Search,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Steps, type StepItem } from "@/components/ui/steps";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/utils";
import {
  DatasourceApiError,
  createDatasource,
  createSession,
  listDatasources,
  uploadDatasourceFile
} from "@/lib/api-client";
import { writeActiveDatasourceId } from "@/lib/datasource-session-context";

type WizardType = "mysql" | "postgresql" | "csv" | "excel";

type WizardState = {
  type: WizardType | "";
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  file: File | null;
  openAfterCreate: boolean;
};

type ConnectionFailureCode =
  | "CONNECTION_AUTH_FAILED"
  | "CONNECTION_NETWORK_UNREACHABLE"
  | "CONNECTION_DATABASE_NOT_FOUND"
  | "CONNECTION_CONFIG_INVALID";

type WizardFailure = {
  message: string;
  code?: ConnectionFailureCode;
  hint?: string;
  action?: "retry" | "previous";
};

const WIZARD_TYPES: Array<{
  type: WizardType;
  title: string;
  description: string;
}> = [
  { type: "csv", title: "本地 CSV", description: "上传 CSV 并生成可复用数据源" },
  { type: "excel", title: "本地 Excel", description: "上传 Excel 并生成可复用数据源" },
  { type: "mysql", title: "MySQL", description: "配置连接信息并创建连接" },
  { type: "postgresql", title: "PostgreSQL", description: "配置连接信息并创建连接" }
];

const TYPE_LABEL: Record<DatasourceType, string> = {
  sqlite: "SQLite",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  csv: "CSV",
  excel: "Excel"
};

const TYPE_FILTERS: Array<{ value: "all" | DatasourceType; label: string }> = [
  { value: "all", label: "全部类型" },
  { value: "sqlite", label: "SQLite" },
  { value: "mysql", label: "MySQL" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "csv", label: "CSV" },
  { value: "excel", label: "Excel" }
];

const WIZARD_STEPS: StepItem[] = [
  { step: 1, title: "选择数据源", subtitle: "挑选接入方式" },
  { step: 2, title: "配置信息", subtitle: "填写连接参数" },
  { step: 3, title: "接入范围确认", subtitle: "确认后创建" }
];

const CONNECTION_FAILURE_HINTS: Record<
  ConnectionFailureCode,
  {
    hint: string;
    action: "retry" | "previous";
  }
> = {
  CONNECTION_AUTH_FAILED: {
    hint: "请检查用户名和密码后重试当前步骤。",
    action: "retry"
  },
  CONNECTION_NETWORK_UNREACHABLE: {
    hint: "请确认主机、端口和网络连通性后重试。",
    action: "retry"
  },
  CONNECTION_DATABASE_NOT_FOUND: {
    hint: "请返回上一步确认数据库名称是否正确。",
    action: "previous"
  },
  CONNECTION_CONFIG_INVALID: {
    hint: "请返回上一步检查连接参数并重新提交。",
    action: "previous"
  }
};

function createEmptyWizardState(): WizardState {
  return {
    type: "",
    name: "",
    host: "127.0.0.1",
    port: "",
    database: "",
    username: "",
    password: "",
    file: null,
    openAfterCreate: true
  };
}

function isConnectionFailureCode(value: string): value is ConnectionFailureCode {
  return value in CONNECTION_FAILURE_HINTS;
}

function resolveWizardFailure(error: unknown): WizardFailure {
  let message = error instanceof Error ? error.message : "创建数据源失败";
  let code: ConnectionFailureCode | undefined;

  if (error instanceof DatasourceApiError && error.code && isConnectionFailureCode(error.code)) {
    code = error.code;
    message = error.message;
  } else if (error instanceof Error) {
    const matchedCode = error.message.match(/\[([A-Z0-9_]+)\]\s*$/)?.[1];
    if (matchedCode && isConnectionFailureCode(matchedCode)) {
      code = matchedCode;
      message = error.message.replace(/\s*\[[A-Z0-9_]+\]\s*$/, "");
    }
  }

  const hint = code ? CONNECTION_FAILURE_HINTS[code].hint : undefined;
  const action = code ? CONNECTION_FAILURE_HINTS[code].action : undefined;
  return {
    message,
    code,
    hint,
    action
  };
}

function datasourceIcon(type: DatasourceType) {
  if (type === "mysql" || type === "postgresql" || type === "sqlite") {
    return <Database className="h-6 w-6 text-blue-600" />;
  }
  return <FileSpreadsheet className="h-6 w-6 text-emerald-600" />;
}

function inferDefaultPort(type: WizardType | ""): string {
  if (type === "mysql") {
    return "3306";
  }
  if (type === "postgresql") {
    return "5432";
  }
  return "";
}

export default function DataSourcesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [activeDatasourceId, setActiveDatasourceId] = useState("");

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DatasourceType>("all");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardSaving, setWizardSaving] = useState(false);
  const [wizardFailure, setWizardFailure] = useState<WizardFailure | null>(null);
  const [wizard, setWizard] = useState<WizardState>(createEmptyWizardState());

  const loadDatasources = async (): Promise<void> => {
    setLoading(true);
    setPageError("");
    try {
      const list = await listDatasources({ includeUnavailable: true });
      setDatasources(list);
    } catch (loadError) {
      setPageError(loadError instanceof Error ? loadError.message : "加载数据源失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDatasources();
  }, []);

  const filteredDatasources = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return datasources.filter((item) => {
      const matchesKeyword =
        !keyword ||
        `${item.name} ${item.id} ${item.type}`.toLowerCase().includes(keyword);
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      return matchesKeyword && matchesType;
    });
  }, [datasources, query, typeFilter]);
  const hasActiveFilters = query.trim().length > 0 || typeFilter !== "all";
  const availableCount = useMemo(
    () => datasources.filter((item) => item.status === "available").length,
    [datasources]
  );
  const fileDatasourceCount = useMemo(
    () => datasources.filter((item) => item.type === "csv" || item.type === "excel").length,
    [datasources]
  );

  const onStartChat = async (datasourceId: string): Promise<void> => {
    setActiveDatasourceId(datasourceId);
    setPageError("");
    try {
      const session = await createSession(datasourceId);
      writeActiveDatasourceId(datasourceId);
      router.push(
        `/chat?datasource=${encodeURIComponent(datasourceId)}&sessionId=${encodeURIComponent(session.id)}`
      );
    } catch (startError) {
      setPageError(startError instanceof Error ? startError.message : "创建会话失败");
      setActiveDatasourceId("");
    }
  };

  const resetWizard = (): void => {
    setWizard(createEmptyWizardState());
    setWizardStep(1);
    setWizardSaving(false);
    setWizardFailure(null);
  };

  const openWizard = (): void => {
    resetWizard();
    setWizardOpen(true);
  };

  const closeWizard = (): void => {
    setWizardOpen(false);
    resetWizard();
  };

  const validateWizardStep2 = (): string => {
    if (!wizard.type) {
      return "请先选择数据源类型";
    }

    if (wizard.type === "mysql" || wizard.type === "postgresql") {
      if (!wizard.name.trim()) {
        return "请输入数据源名称";
      }
      if (!wizard.host.trim() || !wizard.database.trim() || !wizard.username.trim() || !wizard.password.trim()) {
        return "请补全连接信息后再继续";
      }
      return "";
    }

    if (!wizard.file) {
      return "请先选择 CSV/Excel 文件";
    }
    return "";
  };

  const submitWizard = async (): Promise<void> => {
    if (!wizard.type) {
      setWizardFailure({
        message: "请先选择数据源类型"
      });
      return;
    }

    setWizardSaving(true);
    setWizardFailure(null);
    try {
      let created: Datasource;
      if (wizard.type === "mysql" || wizard.type === "postgresql") {
        created = await createDatasource({
          name: wizard.name.trim(),
          type: wizard.type,
          host: wizard.host.trim(),
          port: wizard.port ? Number(wizard.port) : undefined,
          database: wizard.database.trim(),
          username: wizard.username.trim(),
          password: wizard.password,
          shared: true
        });
      } else {
        if (!wizard.file) {
          throw new Error("请先选择文件");
        }
        created = await uploadDatasourceFile({
          file: wizard.file,
          name: wizard.name.trim() || undefined
        });
      }

      await loadDatasources();
      closeWizard();

      if (wizard.openAfterCreate) {
        await onStartChat(created.id);
      }
    } catch (saveError) {
      setWizardFailure(resolveWizardFailure(saveError));
    } finally {
      setWizardSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 sm:p-6">
      <section className="rounded-2xl border border-[var(--border-default)] bg-[linear-gradient(135deg,#ffffff_0%,#f6f9ff_62%,#ecf4ff_100%)] p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              数据接入工作台
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">数据源</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              统一管理数据库与文件数据源，创建后可直接进入问数会话。
            </p>
          </div>

          <div className="grid min-w-[220px] grid-cols-2 gap-3 text-sm sm:min-w-[320px]">
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
              <p className="text-xs text-[var(--text-tertiary)]">总数据源</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{datasources.length}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
              <p className="text-xs text-[var(--text-tertiary)]">可用数据源</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{availableCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
              <p className="text-xs text-[var(--text-tertiary)]">文件型</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{fileDatasourceCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 py-2">
              <p className="text-xs text-[var(--text-tertiary)]">当前筛选</p>
              <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">{filteredDatasources.length}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
              className="pl-9"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as "all" | DatasourceType)}
            className="h-9 rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-panel)] px-3 text-sm text-[var(--text-secondary)] outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--ring)]"
            aria-label="类型筛选"
          >
            {TYPE_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <Button onClick={openWizard} className="h-9 px-4">
            <Plus className="h-4 w-4" />
            新增
          </Button>
        </div>
      </section>

      {loading ? <StateBlock variant="loading">正在加载数据源...</StateBlock> : null}
      {pageError ? <StateBlock variant="error">{pageError}</StateBlock> : null}
      {!loading && !pageError && filteredDatasources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-panel)] p-6">
          <StateBlock variant="idle" className="border-0 bg-transparent px-0 py-0">
            {datasources.length > 0
              ? "暂无匹配数据源，请调整筛选或新建数据源。"
              : "暂无数据源，请先新增一个数据源。"}
          </StateBlock>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasActiveFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setTypeFilter("all");
                }}
              >
                清除筛选
              </Button>
            ) : null}
            <Button onClick={openWizard}>
              <Plus className="h-4 w-4" />
              新增数据源
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredDatasources.map((item) => {
          const unavailable = item.status !== "available";
          return (
            <article
              key={item.id}
              className="group rounded-2xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 shadow-[0_1px_4px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface-sidebar)] ring-1 ring-[var(--border-subtle)]">
                    {datasourceIcon(item.type)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[var(--text-primary)]">{item.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">ID: {item.id}</p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm" aria-label="更多操作">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() => {
                        void navigator.clipboard?.writeText(item.id);
                      }}
                    >
                      复制数据源 ID
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2.5">
                <span className="inline-flex rounded-full border border-[var(--border-default)] bg-[var(--surface-panel)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {TYPE_LABEL[item.type]}
                </span>
                <span
                  className={cn(
                    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                    item.status === "available"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  )}
                >
                  {item.status === "available" ? "可用" : "不可用"}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-tertiary)]">创建后可直接开启问数会话</p>
                <Button
                  size="sm"
                  disabled={unavailable || activeDatasourceId === item.id}
                  onClick={() => {
                    void onStartChat(item.id);
                  }}
                >
                  {activeDatasourceId === item.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                  开启问数
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      <Dialog open={wizardOpen} onOpenChange={(open) => (open ? setWizardOpen(true) : closeWizard())}>
        <DialogContent className="max-h-[90vh] max-w-[980px] gap-0 overflow-hidden border border-[var(--border-default)] bg-[var(--surface-panel)] p-0 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:max-w-4xl">
          <DialogHeader className="gap-4 border-b border-[var(--border-default)] bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] px-7 pt-6 pb-5">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">新增数据源</DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                按步骤完成数据源接入并可直接进入问数。
              </DialogDescription>
            </div>
            <Steps items={WIZARD_STEPS} currentStep={wizardStep} />
          </DialogHeader>

          {wizardFailure ? (
            <div className="mx-7 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">{wizardFailure.message}</p>
              {wizardFailure.hint ? <p className="mt-1 text-xs text-red-700/90">{wizardFailure.hint}</p> : null}
              {wizardFailure.action ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-9 border-red-200 bg-white px-4 text-red-700 hover:bg-red-100"
                  onClick={() => {
                    if (wizardFailure.action === "retry") {
                      void submitWizard();
                      return;
                    }
                    setWizardStep((previous) => (previous === 3 ? 2 : 1));
                  }}
                >
                  {wizardFailure.action === "retry" ? "重试" : "上一步"}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="max-h-[62vh] overflow-auto px-7 py-6">
            {wizardStep === 1 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {WIZARD_TYPES.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      setWizardFailure(null);
                      setWizard((previous) => ({
                        ...previous,
                        type: item.type,
                        port: inferDefaultPort(item.type)
                      }));
                    }}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-all duration-200",
                      wizard.type === item.type
                        ? "border-[var(--action-primary)] bg-[var(--surface-active)] ring-2 ring-[var(--border-brand)]/70 shadow-[0_10px_24px_rgba(37,99,235,0.14)]"
                        : "border-[var(--border-default)] bg-[var(--surface-panel)] hover:-translate-y-0.5 hover:border-[var(--border-brand)] hover:bg-[var(--surface-subtle)] hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "inline-flex h-10 w-10 items-center justify-center rounded-lg",
                          item.type === "mysql" || item.type === "postgresql"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-emerald-100 text-emerald-700"
                        )}
                      >
                        {item.type === "mysql" || item.type === "postgresql" ? (
                          <Database className="h-5 w-5" />
                        ) : (
                          <FileSpreadsheet className="h-5 w-5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-[var(--text-primary)]">{item.title}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          {item.type === "mysql" || item.type === "postgresql" ? "数据库连接" : "文件上传"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>
                  </button>
                ))}
              </div>
            ) : null}

            {wizardStep === 2 ? (
              <div className="space-y-5">
                {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">连接参数</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        建议先使用只读账号，避免误写入业务数据。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">数据源名称</span>
                        <Input
                          value={wizard.name}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, name: event.target.value }));
                          }}
                          placeholder="数据源名称"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">Host</span>
                        <Input
                          value={wizard.host}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, host: event.target.value }));
                          }}
                          placeholder="Host"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">Port</span>
                        <Input
                          value={wizard.port}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, port: event.target.value }));
                          }}
                          placeholder="Port"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">Database</span>
                        <Input
                          value={wizard.database}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, database: event.target.value }));
                          }}
                          placeholder="Database"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">Username</span>
                        <Input
                          value={wizard.username}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, username: event.target.value }));
                          }}
                          placeholder="Username"
                        />
                      </label>

                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">Password</span>
                        <Input
                          type="password"
                          value={wizard.password}
                          onChange={(event) => {
                            setWizardFailure(null);
                            setWizard((prev) => ({ ...prev, password: event.target.value }));
                          }}
                          placeholder="Password"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {(wizard.type === "csv" || wizard.type === "excel") && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">文件上传</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        {wizard.type === "csv" ? "支持 UTF-8 编码 CSV 文件" : "支持 .xls / .xlsx 文件"}
                      </p>
                    </div>
                    <label className="space-y-1">
                      <span className="text-xs text-[var(--text-tertiary)]">数据源名称（可选）</span>
                      <Input
                        value={wizard.name}
                        onChange={(event) => {
                          setWizardFailure(null);
                          setWizard((prev) => ({ ...prev, name: event.target.value }));
                        }}
                        placeholder="数据源名称（可选）"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-[var(--text-tertiary)]">选择文件</span>
                      <Input
                        type="file"
                        accept={wizard.type === "csv" ? ".csv" : ".xls,.xlsx"}
                        onChange={(event) => {
                          setWizardFailure(null);
                          const file = event.target.files?.[0] ?? null;
                          setWizard((prev) => ({ ...prev, file }));
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            ) : null}

            {wizardStep === 3 ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-subtle)] p-4">
                  <p className="text-sm font-medium text-[var(--text-primary)]">接入摘要</p>
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <p className="text-[var(--text-secondary)]">
                      类型：<span className="font-medium text-[var(--text-primary)]">
                        {wizard.type ? WIZARD_TYPES.find((item) => item.type === wizard.type)?.title : "-"}
                      </span>
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      名称：<span className="font-medium text-[var(--text-primary)]">{wizard.name.trim() || "-"}</span>
                    </p>
                    {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                      <p className="text-[var(--text-secondary)]">
                        地址：
                        <span className="font-medium text-[var(--text-primary)]">
                          {" "}
                          {wizard.host || "-"}:{wizard.port || "-"}
                        </span>
                      </p>
                    )}
                    {(wizard.type === "csv" || wizard.type === "excel") && (
                      <p className="text-[var(--text-secondary)]">
                        文件：
                        <span className="font-medium text-[var(--text-primary)]">
                          {" "}
                          {wizard.file?.name || "-"}
                        </span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sidebar)] p-4">
                  <p className="text-sm text-[var(--text-secondary)]">
                    当前版本默认启用所选数据源的全部可查询表。后续会升级为可选表/视图范围配置能力。
                  </p>
                  <label className="mt-3 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <input
                      type="checkbox"
                      checked={wizard.openAfterCreate}
                      onChange={(event) => {
                        setWizardFailure(null);
                        setWizard((previous) => ({
                          ...previous,
                          openAfterCreate: event.target.checked
                        }));
                      }}
                    />
                    创建完成后立即开启问数
                  </label>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--surface-subtle)] px-7 py-4">
            <p className="hidden text-xs text-[var(--text-tertiary)] sm:block">
              完成后将刷新数据源列表，并可按需自动跳转到会话。
            </p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="px-5"
                disabled={wizardSaving}
                onClick={() => {
                  if (wizardStep === 1) {
                    closeWizard();
                    return;
                  }
                  setWizardStep((previous) => (previous === 3 ? 2 : 1));
                }}
              >
                {wizardStep === 1 ? "取消" : "上一步"}
              </Button>

              {wizardStep < 3 ? (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={wizardSaving}
                  onClick={() => {
                    if (wizardStep === 1) {
                      if (!wizard.type) {
                        setWizardFailure({
                          message: "请选择一种数据源类型后继续"
                        });
                        return;
                      }
                      setWizardFailure(null);
                      setWizardStep(2);
                      return;
                    }

                    const validationMessage = validateWizardStep2();
                    if (validationMessage) {
                      setWizardFailure({
                        message: validationMessage
                      });
                      return;
                    }
                    setWizardFailure(null);
                    setWizardStep(3);
                  }}
                >
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={wizardSaving}
                  onClick={() => {
                    void submitWizard();
                  }}
                >
                  {wizardSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  完成创建
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
