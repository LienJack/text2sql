"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Datasource, DatasourceType, DatasourceUpsertPayload } from "@text2sql/shared-types";
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
import { SetupModelsStep } from "@/components/data-sources/setup-models-step";
import { SetupRelationshipsStep } from "@/components/data-sources/setup-relationships-step";
import { cn } from "@/lib/utils";
import {
  AdminApiError,
  commitModelingSetup,
  listWorkspaces,
  listModelingSetupTables,
  recommendModelingSetupRelationships,
  saveModelingSetupSelectedTables,
  type ModelingSetupRelationshipSuggestion,
  type ModelingSetupTableOption,
  type WorkspaceSummary
} from "@/lib/admin-api-client";
import {
  DatasourceApiError,
  createIdempotencyKey,
  createSession,
  listDatasources,
  resolveDatasourceWorkflowApiError,
  submitDatasourceWorkflow,
  uploadDatasourceFile
} from "@/lib/api-client";
import {
  readActiveWorkspaceId,
  writeActiveDatasourceId,
  writeActiveWorkspaceId
} from "@/lib/datasource-session-context";

type EditorMode = "create" | "edit";
type WizardType = "mysql" | "postgresql" | "csv" | "excel" | "sqlite";

type ConnectionFailureCode =
  | "CONNECTION_AUTH_FAILED"
  | "CONNECTION_NETWORK_UNREACHABLE"
  | "CONNECTION_DATABASE_NOT_FOUND"
  | "CONNECTION_CONFIG_INVALID";

type WizardFailure = {
  message: string;
  code?: string;
  stage?: string;
  hint?: string;
  action?: "retry" | "previous";
};

type WizardState = {
  mode: EditorMode;
  datasourceId: string;
  uploadedDatasourceId: string;
  type: WizardType | "";
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  file: File | null;
  workspaceId: string;
  openAfterCreate: boolean;
  submissionKey: string;
};

type SetupWizardState = {
  open: boolean;
  step: 1 | 2;
  workspaceId: string;
  datasourceId: string;
  loading: boolean;
  submitting: boolean;
  tables: ModelingSetupTableOption[];
  selectedTableNames: string[];
  suggestions: ModelingSetupRelationshipSuggestion[];
  selectedSuggestionIds: string[];
  failure: WizardFailure | null;
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
  { step: 2, title: "配置信息", subtitle: "创建或编辑连接并自动绑定当前工作空间" }
];

const SETUP_STEPS: StepItem[] = [
  { step: 1, title: "选择数据表", subtitle: "生成建模基线" },
  { step: 2, title: "确认关系", subtitle: "确认推荐关系" }
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

const STAGE_HINTS: Record<string, { hint: string; action: "retry" | "previous" }> = {
  validation_failed: {
    hint: "请返回上一步检查输入后重新提交。",
    action: "previous"
  },
  workspace_create_failed: {
    hint: "工作空间创建失败，可直接重试当前提交。",
    action: "retry"
  },
  datasource_create_failed: {
    hint: "数据源创建失败，请检查连接参数后重试。",
    action: "retry"
  },
  datasource_update_failed: {
    hint: "数据源更新失败，请检查变更参数后重试。",
    action: "retry"
  },
  binding_apply_failed: {
    hint: "数据源绑定空间失败，请重试。",
    action: "retry"
  }
};

const SETUP_STAGE_HINTS: Record<string, { hint: string; action: "retry" | "previous" }> = {
  setup_tables_load_failed: {
    hint: "加载可选表失败，请重试。",
    action: "retry"
  },
  setup_tables_save_failed: {
    hint: "保存选表失败，请检查选择并重试。",
    action: "retry"
  },
  setup_recommend_failed: {
    hint: "关系建议生成失败，可重试或返回上一步调整选表。",
    action: "retry"
  },
  setup_commit_failed: {
    hint: "建模初始化提交失败，请重试当前步骤。",
    action: "retry"
  }
};

function createEmptyWizardState(defaultWorkspaceId: string): WizardState {
  return {
    mode: "create",
    datasourceId: "",
    uploadedDatasourceId: "",
    type: "",
    name: "",
    host: "127.0.0.1",
    port: "",
    database: "",
    username: "",
    password: "",
    file: null,
    workspaceId: defaultWorkspaceId,
    openAfterCreate: true,
    submissionKey: ""
  };
}

function createEmptySetupWizardState(): SetupWizardState {
  return {
    open: false,
    step: 1,
    workspaceId: "",
    datasourceId: "",
    loading: false,
    submitting: false,
    tables: [],
    selectedTableNames: [],
    suggestions: [],
    selectedSuggestionIds: [],
    failure: null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSelectedTableNames(value: string[]): string[] {
  return Array.from(
    new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeSelectedIds(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function isConnectionFailureCode(value: string): value is ConnectionFailureCode {
  return value in CONNECTION_FAILURE_HINTS;
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

function datasourceIcon(type: DatasourceType) {
  if (type === "mysql" || type === "postgresql" || type === "sqlite") {
    return <Database className="h-6 w-6 text-blue-600" />;
  }
  return <FileSpreadsheet className="h-6 w-6 text-emerald-600" />;
}

function readConfigString(config: Datasource["config"], key: string): string {
  if (!config || typeof config !== "object") {
    return "";
  }
  const value = (config as Record<string, unknown>)[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function resolveWizardFailure(error: unknown): WizardFailure {
  let message = error instanceof Error ? error.message : "提交失败";
  let code: string | undefined;
  let stage: string | undefined;

  if (error instanceof DatasourceApiError) {
    message = error.message;
    code = error.code;
    stage = error.stage;
  }

  const workflowError = resolveDatasourceWorkflowApiError(error);
  if (workflowError.code && !code) {
    code = workflowError.code;
  }
  if (workflowError.stage && !stage) {
    stage = workflowError.stage;
  }

  if (code && isConnectionFailureCode(code)) {
    return {
      message,
      code,
      stage,
      hint: CONNECTION_FAILURE_HINTS[code].hint,
      action: CONNECTION_FAILURE_HINTS[code].action
    };
  }

  if (stage && STAGE_HINTS[stage]) {
    return {
      message,
      code,
      stage,
      hint: STAGE_HINTS[stage].hint,
      action: STAGE_HINTS[stage].action
    };
  }

  return {
    message,
    code,
    stage,
    action: "retry"
  };
}

function resolveSetupFailure(
  error: unknown,
  fallbackStage: string
): WizardFailure {
  let message = error instanceof Error ? error.message : "建模设置失败";
  let code: string | undefined;
  let stage: string | undefined;

  if (error instanceof AdminApiError) {
    message = error.message;
    code = error.code;
    if (isRecord(error.details) && typeof error.details.stage === "string") {
      stage = error.details.stage;
    }
  }

  const resolvedStage = stage || fallbackStage;
  const stageHint = SETUP_STAGE_HINTS[resolvedStage];

  return {
    message,
    code,
    stage: resolvedStage,
    hint: stageHint?.hint,
    action: stageHint?.action ?? "retry"
  };
}

function toWizardType(type: DatasourceType): WizardType {
  if (type === "mysql" || type === "postgresql" || type === "csv" || type === "excel" || type === "sqlite") {
    return type;
  }
  return "mysql";
}

function DataSourcesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceIdFromQuery = searchParams.get("workspaceId")?.trim() ?? "";

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [activeDatasourceId, setActiveDatasourceId] = useState("");

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | DatasourceType>("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorStep, setEditorStep] = useState<1 | 2>(1);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorFailure, setEditorFailure] = useState<WizardFailure | null>(null);
  const [wizard, setWizard] = useState<WizardState>(() =>
    createEmptyWizardState(readActiveWorkspaceId())
  );

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [setupWizard, setSetupWizard] = useState<SetupWizardState>(() =>
    createEmptySetupWizardState()
  );

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

  const loadWorkspaces = async (preferredWorkspaceId?: string): Promise<void> => {
    try {
      const result = await listWorkspaces({ page: 1, pageSize: 200 });
      setWorkspaces(result.items);
      const preferred =
        preferredWorkspaceId?.trim() ||
        readActiveWorkspaceId() ||
        wizard.workspaceId ||
        workspaceIdFromQuery;
      const resolvedWorkspaceId =
        (preferred && result.items.find((item) => item.id === preferred)?.id) ||
        result.items[0]?.id ||
        "";
      setWizard((previous) => ({
        ...previous,
        workspaceId: resolvedWorkspaceId
      }));
      if (resolvedWorkspaceId) {
        writeActiveWorkspaceId(resolvedWorkspaceId);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "加载工作空间失败");
    }
  };

  useEffect(() => {
    void loadDatasources();
  }, []);

  useEffect(() => {
    const workspaceFromQuery = workspaceIdFromQuery.trim();
    if (workspaceFromQuery) {
      writeActiveWorkspaceId(workspaceFromQuery);
    }
  }, [workspaceIdFromQuery]);

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
  const currentWorkspaceName = useMemo(() => {
    if (!wizard.workspaceId.trim()) {
      return "未选择";
    }
    return (
      workspaces.find((workspace) => workspace.id === wizard.workspaceId)?.name ??
      wizard.workspaceId
    );
  }, [wizard.workspaceId, workspaces]);

  const onStartChat = async (
    datasourceId: string,
    workspaceIdOverride?: string
  ): Promise<void> => {
    const activeWorkspaceId =
      workspaceIdOverride?.trim() ||
      readActiveWorkspaceId() ||
      wizard.workspaceId.trim();
    setActiveDatasourceId(datasourceId);
    setPageError("");
    try {
      const session = await createSession(datasourceId, {
        workspaceId: activeWorkspaceId || undefined
      });
      writeActiveDatasourceId(datasourceId);
      writeActiveWorkspaceId(activeWorkspaceId);
      router.push(
        `/chat?datasource=${encodeURIComponent(datasourceId)}&sessionId=${encodeURIComponent(session.id)}`
      );
    } catch (startError) {
      setPageError(startError instanceof Error ? startError.message : "创建会话失败");
      setActiveDatasourceId("");
    }
  };

  const closeSetupWizard = (): void => {
    setSetupWizard(createEmptySetupWizardState());
  };

  const navigateToModeling = (workspaceId: string, datasourceId: string): void => {
    writeActiveWorkspaceId(workspaceId);
    writeActiveDatasourceId(datasourceId);
    router.push(`/modeling?datasourceId=${encodeURIComponent(datasourceId)}`);
  };

  const openSetupWizard = async (workspaceId: string, datasourceId: string): Promise<void> => {
    setSetupWizard({
      open: true,
      step: 1,
      workspaceId,
      datasourceId,
      loading: true,
      submitting: false,
      tables: [],
      selectedTableNames: [],
      suggestions: [],
      selectedSuggestionIds: [],
      failure: null
    });

    try {
      const tables = await listModelingSetupTables(workspaceId, datasourceId);
      setSetupWizard((previous) => ({
        ...previous,
        loading: false,
        tables,
        selectedTableNames: tables.map((item) => item.tableName)
      }));
    } catch (error) {
      setSetupWizard((previous) => ({
        ...previous,
        loading: false,
        failure: resolveSetupFailure(error, "setup_tables_load_failed")
      }));
    }
  };

  const resolveWorkspaceIdForSetup = async (): Promise<string> => {
    const candidates = [
      readActiveWorkspaceId(),
      wizard.workspaceId
    ]
      .map((item) => item.trim())
      .filter(Boolean);
    const matchedCachedWorkspaceId = candidates.find((candidate) =>
      workspaces.some((workspace) => workspace.id === candidate)
    );
    if (matchedCachedWorkspaceId) {
      return matchedCachedWorkspaceId;
    }
    if (workspaces[0]?.id) {
      return workspaces[0].id;
    }
    const result = await listWorkspaces({ page: 1, pageSize: 200 });
    setWorkspaces(result.items);
    const matchedRemoteWorkspaceId = candidates.find((candidate) =>
      result.items.some((workspace) => workspace.id === candidate)
    );
    return matchedRemoteWorkspaceId || result.items[0]?.id?.trim() || "";
  };

  const openSetupWizardFromDatasourceCard = async (datasourceId: string): Promise<void> => {
    try {
      const resolvedWorkspaceId = await resolveWorkspaceIdForSetup();
      if (!resolvedWorkspaceId) {
        setPageError("未找到可用工作空间，请先在入口选择或创建工作空间后再执行建模设置。");
        return;
      }
      setPageError("");
      writeActiveWorkspaceId(resolvedWorkspaceId);
      writeActiveDatasourceId(datasourceId);
      await openSetupWizard(resolvedWorkspaceId, datasourceId);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "打开建模设置失败");
    }
  };

  const runSetupModelsStep = async (): Promise<void> => {
    if (setupWizard.submitting) {
      return;
    }
    const selectedTableNames = normalizeSelectedTableNames(setupWizard.selectedTableNames);
    const previousSuggestionIds = normalizeSelectedIds(setupWizard.selectedSuggestionIds);
    const previousSuggestionIdSet = new Set(previousSuggestionIds);
    const previousAllSuggestionIdSet = new Set(
      setupWizard.suggestions.map((item) => item.id)
    );
    const hasExistingSuggestionSelectionState =
      setupWizard.step === 2 || previousAllSuggestionIdSet.size > 0;
    if (selectedTableNames.length === 0) {
      setSetupWizard((previous) => ({
        ...previous,
        failure: {
          message: "请至少选择一张数据表后继续。",
          stage: "setup_tables_save_failed",
          action: "previous"
        }
      }));
      return;
    }

    setSetupWizard((previous) => ({
      ...previous,
      submitting: true,
      failure: null
    }));

    let currentStage = "setup_tables_save_failed";
    try {
      const snapshot = await saveModelingSetupSelectedTables(
        setupWizard.workspaceId,
        setupWizard.datasourceId,
        {
          selectedTables: selectedTableNames
        }
      );

      const snapshotSelectedTables =
        snapshot.selectedTables ?? snapshot.selectedTableNames ?? [];
      const persistedTableNames =
        snapshotSelectedTables.length > 0 ? snapshotSelectedTables : selectedTableNames;

      currentStage = "setup_recommend_failed";
      const suggestions = await recommendModelingSetupRelationships(
        setupWizard.workspaceId,
        setupWizard.datasourceId,
        {
          selectedTables: persistedTableNames
        }
      );
      const nextSelectedSuggestionIds = hasExistingSuggestionSelectionState
        ? suggestions
            .filter(
              (item) =>
                previousSuggestionIdSet.has(item.id) || !previousAllSuggestionIdSet.has(item.id)
            )
            .map((item) => item.id)
        : suggestions.map((item) => item.id);
      setSetupWizard((previous) => ({
        ...previous,
        step: 2,
        submitting: false,
        selectedTableNames: persistedTableNames,
        suggestions,
        selectedSuggestionIds: nextSelectedSuggestionIds,
        failure: null
      }));
    } catch (error) {
      setSetupWizard((previous) => ({
        ...previous,
        submitting: false,
        failure: resolveSetupFailure(error, currentStage)
      }));
    }
  };

  const commitSetupWizardStep = async (): Promise<void> => {
    if (setupWizard.submitting) {
      return;
    }
    setSetupWizard((previous) => ({
      ...previous,
      submitting: true,
      failure: null
    }));
    try {
      await commitModelingSetup(setupWizard.workspaceId, setupWizard.datasourceId, {
        selectedTables: setupWizard.selectedTableNames,
        selectedRecommendationIds: normalizeSelectedIds(setupWizard.selectedSuggestionIds)
      });
      const targetWorkspaceId = setupWizard.workspaceId;
      const targetDatasourceId = setupWizard.datasourceId;
      closeSetupWizard();
      navigateToModeling(targetWorkspaceId, targetDatasourceId);
    } catch (error) {
      setSetupWizard((previous) => ({
        ...previous,
        submitting: false,
        failure: resolveSetupFailure(error, "setup_commit_failed")
      }));
    }
  };

  const retrySetupAction = async (): Promise<void> => {
    const stage = setupWizard.failure?.stage;
    if (!stage) {
      return;
    }
    if (stage === "setup_tables_load_failed") {
      await openSetupWizard(setupWizard.workspaceId, setupWizard.datasourceId);
      return;
    }
    if (stage === "setup_tables_save_failed" || stage === "setup_recommend_failed") {
      await runSetupModelsStep();
      return;
    }
    if (stage === "setup_commit_failed") {
      await commitSetupWizardStep();
    }
  };

  const resetEditor = (mode: EditorMode, datasource?: Datasource): void => {
    const defaultState = createEmptyWizardState(readActiveWorkspaceId());

    if (mode === "edit" && datasource) {
      const defaultPort =
        readConfigString(datasource.config, "port") || inferDefaultPort(toWizardType(datasource.type));
      const nextState: WizardState = {
        ...defaultState,
        mode: "edit",
        datasourceId: datasource.id,
        uploadedDatasourceId: datasource.id,
        type: toWizardType(datasource.type),
        name: datasource.name,
        host: readConfigString(datasource.config, "host"),
        port: defaultPort,
        database: readConfigString(datasource.config, "database"),
        username: readConfigString(datasource.config, "username"),
        openAfterCreate: false
      };
      setWizard(nextState);
      setEditorStep(2);
      setEditorFailure(null);
      return;
    }

    setWizard(defaultState);
    setEditorStep(1);
    setEditorFailure(null);
  };

  const openCreateEditor = (): void => {
    resetEditor("create");
    setEditorOpen(true);
    void loadWorkspaces(readActiveWorkspaceId());
  };

  const openEditEditor = (datasource: Datasource): void => {
    resetEditor("edit", datasource);
    setEditorOpen(true);
    void loadWorkspaces(readActiveWorkspaceId());
  };

  const closeEditor = (): void => {
    setEditorOpen(false);
    resetEditor("create");
  };

  const patchWizard = (patch: Partial<WizardState>): void => {
    setEditorFailure(null);
    setWizard((previous) => ({
      ...previous,
      ...patch,
      submissionKey: patch.submissionKey ?? ""
    }));
  };

  const validateStep2 = (): string => {
    if (!wizard.type) {
      return "请先选择数据源类型";
    }

    if (wizard.type === "mysql" || wizard.type === "postgresql") {
      if (!wizard.name.trim()) {
        return "请输入数据源名称";
      }
      if (!wizard.host.trim() || !wizard.database.trim() || !wizard.username.trim()) {
        return "请补全连接信息后再继续";
      }
      if (wizard.mode === "create" && !wizard.password.trim()) {
        return "新建数据库连接时必须填写密码";
      }
      return "";
    }

    if (wizard.mode === "create" && (wizard.type === "csv" || wizard.type === "excel") && !wizard.file) {
      return "请先选择 CSV/Excel 文件";
    }

    if (!wizard.name.trim()) {
      return "请输入数据源名称";
    }

    return "";
  };

  const validateWorkspaceBinding = (): string => {
    if (!wizard.workspaceId.trim()) {
      return "当前未检测到工作空间，请先在入口选择工作空间后再提交。";
    }
    return "";
  };

  const buildDatasourcePayload = (): DatasourceUpsertPayload => {
    const payload: DatasourceUpsertPayload = {};
    if (wizard.name.trim()) {
      payload.name = wizard.name.trim();
    }
    if (wizard.mode === "create") {
      payload.type = wizard.type as DatasourceType;
      payload.shared = true;
    }

    if (wizard.type === "mysql" || wizard.type === "postgresql") {
      payload.host = wizard.host.trim();
      payload.port = wizard.port ? Number(wizard.port) : undefined;
      payload.database = wizard.database.trim();
      payload.username = wizard.username.trim();
      if (wizard.password.trim()) {
        payload.password = wizard.password;
      }
    }

    return payload;
  };

  const submitEditor = async (): Promise<void> => {
    if (editorSaving) {
      return;
    }

    const stepValidationMessage = validateStep2();
    if (stepValidationMessage) {
      setEditorFailure({ message: stepValidationMessage, action: "previous" });
      return;
    }

    const validationMessage = validateWorkspaceBinding();
    if (validationMessage) {
      setEditorFailure({ message: validationMessage, action: "previous" });
      return;
    }

    setEditorSaving(true);
    setEditorFailure(null);

    const idempotencyKey = wizard.submissionKey || createIdempotencyKey("datasource-editor");
    if (!wizard.submissionKey) {
      setWizard((previous) => ({ ...previous, submissionKey: idempotencyKey }));
    }

    try {
      let targetDatasourceId = wizard.datasourceId;
      if (wizard.mode === "create" && (wizard.type === "csv" || wizard.type === "excel")) {
        let uploadedDatasourceId = wizard.uploadedDatasourceId;
        if (!uploadedDatasourceId) {
          if (!wizard.file) {
            throw new Error("请先上传文件");
          }
          const uploaded = await uploadDatasourceFile({
            file: wizard.file,
            name: wizard.name.trim() || undefined
          });
          uploadedDatasourceId = uploaded.id;
          targetDatasourceId = uploaded.id;
          setWizard((previous) => ({
            ...previous,
            uploadedDatasourceId,
            datasourceId: uploadedDatasourceId
          }));
        }

        const editPayload: DatasourceUpsertPayload = {};
        if (wizard.name.trim()) {
          editPayload.name = wizard.name.trim();
        }

        const workflowResult = await submitDatasourceWorkflow(
          {
            mode: "edit",
            datasourceId: uploadedDatasourceId,
            datasource: Object.keys(editPayload).length > 0 ? editPayload : undefined,
            workspaceId: wizard.workspaceId
          },
          { idempotencyKey }
        );

        targetDatasourceId = workflowResult.datasourceId;
      } else if (wizard.mode === "create") {
        const workflowResult = await submitDatasourceWorkflow(
          {
            mode: "create",
            datasource: buildDatasourcePayload(),
            workspaceId: wizard.workspaceId
          },
          { idempotencyKey }
        );
        targetDatasourceId = workflowResult.datasourceId;
      } else {
        const payload = buildDatasourcePayload();
        const workflowResult = await submitDatasourceWorkflow(
          {
            mode: "edit",
            datasourceId: wizard.datasourceId,
            datasource: Object.keys(payload).length > 0 ? payload : undefined,
            workspaceId: wizard.workspaceId
          },
          { idempotencyKey }
        );
        targetDatasourceId = workflowResult.datasourceId;
      }

      await loadDatasources();
      const mode = wizard.mode;
      const shouldOpenChat = wizard.openAfterCreate;
      const selectedWorkspaceId = wizard.workspaceId;
      closeEditor();

      if (mode === "create" && targetDatasourceId) {
        await openSetupWizard(selectedWorkspaceId, targetDatasourceId);
        return;
      }

      if (shouldOpenChat && targetDatasourceId) {
        await onStartChat(targetDatasourceId, selectedWorkspaceId);
      }
    } catch (submitError) {
      setEditorFailure(resolveWizardFailure(submitError));
    } finally {
      setEditorSaving(false);
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
              统一管理数据库与文件数据源，创建或编辑时必须绑定工作空间。
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

          <Button onClick={openCreateEditor} className="h-9 px-4">
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
            <Button onClick={openCreateEditor}>
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
                    <DropdownMenuItem
                      disabled={unavailable}
                      onClick={() => {
                        void openSetupWizardFromDatasourceCard(item.id);
                      }}
                    >
                      建模设置
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openEditEditor(item)}>编辑数据源</DropdownMenuItem>
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

      <Dialog open={editorOpen} onOpenChange={(open) => (open ? setEditorOpen(true) : closeEditor())}>
        <DialogContent className="max-h-[90vh] max-w-[980px] gap-0 overflow-hidden border border-[var(--border-default)] bg-[var(--surface-panel)] p-0 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:max-w-4xl">
          <DialogHeader className="gap-4 border-b border-[var(--border-default)] bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] px-7 pt-6 pb-5">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
                {wizard.mode === "create" ? "新增数据源" : "编辑数据源"}
              </DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                创建和编辑会自动绑定当前工作空间，无需在此页重复选择。
              </DialogDescription>
            </div>
            <Steps items={WIZARD_STEPS} currentStep={editorStep} />
          </DialogHeader>

          {editorFailure ? (
            <div className="mx-7 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">{editorFailure.message}</p>
              {editorFailure.hint ? <p className="mt-1 text-xs text-red-700/90">{editorFailure.hint}</p> : null}
              {editorFailure.stage ? (
                <p className="mt-1 text-xs text-red-700/90">失败阶段：{editorFailure.stage}</p>
              ) : null}
              {editorFailure.action ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-9 border-red-200 bg-white px-4 text-red-700 hover:bg-red-100"
                  onClick={() => {
                    if (editorFailure.action === "retry") {
                      void submitEditor();
                      return;
                    }
                    setEditorStep(2);
                  }}
                >
                  {editorFailure.action === "retry" ? "重试" : "上一步"}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="max-h-[62vh] overflow-auto px-7 py-6">
            {editorStep === 1 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {WIZARD_TYPES.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => {
                      patchWizard({
                        type: item.type,
                        port: inferDefaultPort(item.type)
                      });
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

            {editorStep === 2 ? (
              <div className="space-y-5">
                {(wizard.type === "mysql" || wizard.type === "postgresql" || wizard.type === "sqlite") && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">连接参数</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        编辑模式下只会更新你填写的连接信息；密码留空则不更新。
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-[var(--text-tertiary)]">数据源名称</span>
                        <Input
                          value={wizard.name}
                          onChange={(event) => patchWizard({ name: event.target.value })}
                          placeholder="数据源名称"
                        />
                      </label>

                      {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--text-tertiary)]">Host</span>
                          <Input
                            value={wizard.host}
                            onChange={(event) => patchWizard({ host: event.target.value })}
                            placeholder="Host"
                          />
                        </label>
                      )}

                      {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--text-tertiary)]">Port</span>
                          <Input
                            value={wizard.port}
                            onChange={(event) => patchWizard({ port: event.target.value })}
                            placeholder="Port"
                          />
                        </label>
                      )}

                      {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--text-tertiary)]">Database</span>
                          <Input
                            value={wizard.database}
                            onChange={(event) => patchWizard({ database: event.target.value })}
                            placeholder="Database"
                          />
                        </label>
                      )}

                      {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--text-tertiary)]">Username</span>
                          <Input
                            value={wizard.username}
                            onChange={(event) => patchWizard({ username: event.target.value })}
                            placeholder="Username"
                          />
                        </label>
                      )}

                      {(wizard.type === "mysql" || wizard.type === "postgresql") && (
                        <label className="space-y-1">
                          <span className="text-xs text-[var(--text-tertiary)]">
                            Password {wizard.mode === "edit" ? "（留空不更新）" : ""}
                          </span>
                          <Input
                            type="password"
                            value={wizard.password}
                            onChange={(event) => patchWizard({ password: event.target.value })}
                            placeholder="Password"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                )}

                {wizard.mode === "create" && (wizard.type === "csv" || wizard.type === "excel") && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">文件上传</p>
                      <p className="text-xs text-[var(--text-tertiary)]">
                        先上传文件创建数据源，保存时会自动绑定当前工作空间。
                      </p>
                    </div>
                    <label className="space-y-1">
                      <span className="text-xs text-[var(--text-tertiary)]">数据源名称</span>
                      <Input
                        value={wizard.name}
                        onChange={(event) => patchWizard({ name: event.target.value })}
                        placeholder="数据源名称"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-[var(--text-tertiary)]">选择文件</span>
                      <Input
                        type="file"
                        accept={wizard.type === "csv" ? ".csv" : ".xls,.xlsx"}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          patchWizard({
                            file,
                            uploadedDatasourceId: "",
                            datasourceId: ""
                          });
                        }}
                      />
                    </label>
                  </div>
                )}

                {wizard.mode === "edit" && (wizard.type === "csv" || wizard.type === "excel") && (
                  <div className="space-y-4">
                    <p className="text-sm font-medium text-[var(--text-primary)]">文件数据源基础信息</p>
                    <label className="space-y-1">
                      <span className="text-xs text-[var(--text-tertiary)]">数据源名称</span>
                      <Input
                        value={wizard.name}
                        onChange={(event) => patchWizard({ name: event.target.value })}
                        placeholder="数据源名称"
                      />
                    </label>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-sidebar)] p-4">
                  <p className="text-sm text-[var(--text-secondary)]">
                    将自动绑定当前工作空间：<span className="font-medium text-[var(--text-primary)]">{currentWorkspaceName}</span>。
                  </p>
                  {wizard.mode === "edit" ? (
                    <label className="mt-3 flex items-center gap-2 text-sm text-[var(--text-primary)]">
                      <input
                        type="checkbox"
                        checked={wizard.openAfterCreate}
                        onChange={(event) => patchWizard({ openAfterCreate: event.target.checked })}
                      />
                      保存后立即开启问数
                    </label>
                  ) : (
                    <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                      创建成功后会自动进入建模设置向导（选表与关系建议确认）。
                    </p>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--surface-subtle)] px-7 py-4">
            <p className="hidden text-xs text-[var(--text-tertiary)] sm:block">
              提交中会复用同一个幂等键，并锁定按钮防止重复提交。
            </p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="px-5"
                disabled={editorSaving}
                onClick={() => {
                  if (editorStep === 1) {
                    closeEditor();
                    return;
                  }
                  if (editorStep === 2 && wizard.mode === "edit") {
                    closeEditor();
                    return;
                  }
                  setEditorStep(1);
                }}
              >
                {editorStep === 1 || (editorStep === 2 && wizard.mode === "edit") ? "取消" : "上一步"}
              </Button>

              {editorStep < 2 ? (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={editorSaving}
                  onClick={() => {
                    if (editorStep === 1) {
                      if (!wizard.type) {
                        setEditorFailure({ message: "请选择一种数据源类型后继续" });
                        return;
                      }
                      setEditorFailure(null);
                      setEditorStep(2);
                    }
                  }}
                >
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={editorSaving}
                  onClick={() => {
                    void submitEditor();
                  }}
                >
                  {editorSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {wizard.mode === "create" ? "完成创建" : "保存并绑定"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={setupWizard.open}
        onOpenChange={(open) => {
          if (!open) {
            closeSetupWizard();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-[980px] gap-0 overflow-hidden border border-[var(--border-default)] bg-[var(--surface-panel)] p-0 shadow-[0_24px_70px_rgba(15,23,42,0.18)] sm:max-w-4xl">
          <DialogHeader className="gap-4 border-b border-[var(--border-default)] bg-[linear-gradient(180deg,#ffffff_0%,#f5f9ff_100%)] px-7 pt-6 pb-5">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold text-[var(--text-primary)]">
                建模设置向导
              </DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                选择建模表并确认关系建议，完成后将进入建模工作台。
              </DialogDescription>
            </div>
            <Steps items={SETUP_STEPS} currentStep={setupWizard.step} />
          </DialogHeader>

          {setupWizard.failure ? (
            <div className="mx-7 mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-medium text-red-700">{setupWizard.failure.message}</p>
              {setupWizard.failure.hint ? (
                <p className="mt-1 text-xs text-red-700/90">{setupWizard.failure.hint}</p>
              ) : null}
              {setupWizard.failure.stage ? (
                <p className="mt-1 text-xs text-red-700/90">失败阶段：{setupWizard.failure.stage}</p>
              ) : null}
              {setupWizard.failure.action ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-9 border-red-200 bg-white px-4 text-red-700 hover:bg-red-100"
                  onClick={() => {
                    if (setupWizard.failure?.action === "retry") {
                      void retrySetupAction();
                      return;
                    }
                    setSetupWizard((previous) => ({
                      ...previous,
                      step: 1,
                      failure: null
                    }));
                  }}
                >
                  {setupWizard.failure.action === "retry" ? "重试" : "上一步"}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="max-h-[62vh] overflow-auto px-7 py-6">
            {setupWizard.step === 1 ? (
              <SetupModelsStep
                tables={setupWizard.tables}
                selectedTableNames={setupWizard.selectedTableNames}
                loading={setupWizard.loading}
                disabled={setupWizard.submitting}
                onSelectionChange={(nextSelectedTableNames) =>
                  setSetupWizard((previous) => ({
                    ...previous,
                    selectedTableNames: nextSelectedTableNames,
                    failure: null
                  }))
                }
              />
            ) : (
              <SetupRelationshipsStep
                suggestions={setupWizard.suggestions}
                selectedSuggestionIds={setupWizard.selectedSuggestionIds}
                disabled={setupWizard.submitting}
                onSelectionChange={(nextSelectedSuggestionIds) =>
                  setSetupWizard((previous) => ({
                    ...previous,
                    selectedSuggestionIds: nextSelectedSuggestionIds,
                    failure: null
                  }))
                }
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-default)] bg-[var(--surface-subtle)] px-7 py-4">
            <p className="hidden text-xs text-[var(--text-tertiary)] sm:block">
              失败后会保留你当前的选择，可直接重试。
            </p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="outline"
                size="lg"
                className="px-5"
                disabled={setupWizard.submitting}
                onClick={() => {
                  if (setupWizard.step === 1) {
                    closeSetupWizard();
                    return;
                  }
                  setSetupWizard((previous) => ({
                    ...previous,
                    step: 1,
                    failure: null
                  }));
                }}
              >
                {setupWizard.step === 1 ? "稍后设置" : "上一步"}
              </Button>

              {setupWizard.step === 1 ? (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={setupWizard.loading || setupWizard.submitting}
                  onClick={() => {
                    void runSetupModelsStep();
                  }}
                >
                  {setupWizard.submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  下一步：确认关系
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="px-5"
                  disabled={setupWizard.submitting}
                  onClick={() => {
                    void commitSetupWizardStep();
                  }}
                >
                  {setupWizard.submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {setupWizard.suggestions.length === 0
                    ? "继续进入建模页"
                    : "完成设置并进入建模页"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DataSourcesPage() {
  return (
    <Suspense fallback={<StateBlock variant="loading">正在加载数据源页面...</StateBlock>}>
      <DataSourcesPageContent />
    </Suspense>
  );
}
