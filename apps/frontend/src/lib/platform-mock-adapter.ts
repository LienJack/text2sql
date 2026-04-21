export type HealthStatus = "healthy" | "warning" | "error";

export interface OverviewStat {
  id: string;
  label: string;
  value: string;
  trend: string;
  status: HealthStatus;
}

export interface DataSourceConnection {
  id: string;
  name: string;
  engine: string;
  lastSync: string;
  status: HealthStatus;
}

export interface DataSourceField {
  id: string;
  name: string;
  type: string;
  description: string;
  mode: "dimension" | "metric" | "sensitive";
  enabled: boolean;
}

export interface DataSourceTable {
  id: string;
  name: string;
  description: string;
  fieldCount: number;
  enabled: boolean;
  fields: DataSourceField[];
}

export interface DashboardCard {
  id: string;
  title: string;
  owner: string;
  status: "published" | "draft";
  updatedAt: string;
  views: number;
  chartType: "line" | "bar" | "pie";
}

export interface LlmModelConfig {
  id: string;
  alias: string;
  provider: string;
  model: string;
  status: HealthStatus;
  default: boolean;
  updatedAt: string;
}

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  status: "active" | "disabled";
  lastLogin: string;
}

export interface PlatformSettingsView {
  models: LlmModelConfig[];
  users: PlatformUser[];
}

export interface DataSourcesView {
  connections: DataSourceConnection[];
  tablesByConnection: Record<string, DataSourceTable[]>;
}

const overviewStats: OverviewStat[] = [
  { id: "chat", label: "今日问数请求", value: "1,284", trend: "+12.8%", status: "healthy" },
  { id: "accuracy", label: "SQL 执行成功率", value: "96.4%", trend: "+1.2%", status: "healthy" },
  { id: "sync", label: "待同步会话", value: "3", trend: "-2", status: "warning" },
  { id: "model", label: "模型健康度", value: "2/3", trend: "1 个异常", status: "error" }
];

const dataSources: DataSourcesView = {
  connections: [
    { id: "ds-main", name: "业务核心库_MySQL", engine: "MySQL", lastSync: "10 分钟前", status: "healthy" },
    { id: "ds-user", name: "用户行为库_PostgreSQL", engine: "PostgreSQL", lastSync: "1 小时前", status: "healthy" },
    { id: "ds-archive", name: "历史归档库_ClickHouse", engine: "ClickHouse", lastSync: "3 天前", status: "error" }
  ],
  tablesByConnection: {
    "ds-main": [
      {
        id: "orders",
        name: "orders",
        description: "核心订单明细表",
        fieldCount: 24,
        enabled: true,
        fields: [
          {
            id: "orders.id",
            name: "id",
            type: "BIGINT",
            description: "订单主键 ID",
            mode: "dimension",
            enabled: true
          },
          {
            id: "orders.amount",
            name: "amount",
            type: "DECIMAL(10,2)",
            description: "订单金额",
            mode: "metric",
            enabled: true
          },
          {
            id: "orders.user_phone",
            name: "user_phone",
            type: "VARCHAR(20)",
            description: "用户手机号",
            mode: "sensitive",
            enabled: false
          }
        ]
      },
      {
        id: "users",
        name: "users",
        description: "用户档案表",
        fieldCount: 12,
        enabled: true,
        fields: [
          {
            id: "users.id",
            name: "id",
            type: "BIGINT",
            description: "用户主键",
            mode: "dimension",
            enabled: true
          },
          {
            id: "users.signup_at",
            name: "signup_at",
            type: "DATETIME",
            description: "注册时间",
            mode: "dimension",
            enabled: true
          }
        ]
      }
    ],
    "ds-user": [
      {
        id: "events",
        name: "events",
        description: "用户行为事件表",
        fieldCount: 36,
        enabled: true,
        fields: [
          {
            id: "events.event_name",
            name: "event_name",
            type: "VARCHAR(128)",
            description: "事件名称",
            mode: "dimension",
            enabled: true
          }
        ]
      }
    ],
    "ds-archive": []
  }
};

const dashboards: DashboardCard[] = [
  {
    id: "board-sales",
    title: "Q1 销售大盘",
    owner: "我",
    status: "published",
    updatedAt: "2 小时前",
    views: 128,
    chartType: "line"
  },
  {
    id: "board-growth",
    title: "用户增长留存追踪",
    owner: "我",
    status: "draft",
    updatedAt: "昨天",
    views: 0,
    chartType: "bar"
  },
  {
    id: "board-risk",
    title: "异常订单排查",
    owner: "李四",
    status: "published",
    updatedAt: "1 天前",
    views: 45,
    chartType: "pie"
  }
];

const settingsView: PlatformSettingsView = {
  models: [
    {
      id: "model-gpt4",
      alias: "GPT-4 Turbo",
      provider: "OpenAI",
      model: "gpt-4-turbo-preview",
      status: "healthy",
      default: true,
      updatedAt: "2026-04-08"
    },
    {
      id: "model-claude",
      alias: "Claude 3 Opus",
      provider: "Anthropic",
      model: "claude-3-opus-20240229",
      status: "error",
      default: false,
      updatedAt: "2026-04-07"
    },
    {
      id: "model-qwen",
      alias: "Qwen Max",
      provider: "Alibaba",
      model: "qwen-max",
      status: "healthy",
      default: false,
      updatedAt: "2026-04-05"
    }
  ],
  users: [
    {
      id: "user-zhangsan",
      name: "张三",
      email: "zhangsan@company.com",
      role: "系统管理员",
      department: "数据组",
      status: "active",
      lastLogin: "今天 09:23"
    },
    {
      id: "user-lisi",
      name: "李四",
      email: "lisi@company.com",
      role: "数据分析师",
      department: "运营部",
      status: "active",
      lastLogin: "昨天 14:10"
    },
    {
      id: "user-wangwu",
      name: "王五",
      email: "wangwu@company.com",
      role: "普通用户",
      department: "销售部",
      status: "disabled",
      lastLogin: "1 个月前"
    }
  ]
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function delay(ms = 120): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchOverviewStats(): Promise<OverviewStat[]> {
  await delay();
  return clone(overviewStats);
}

export async function fetchDataSourcesView(): Promise<DataSourcesView> {
  await delay();
  return clone(dataSources);
}

export async function fetchDashboards(): Promise<DashboardCard[]> {
  await delay();
  return clone(dashboards);
}

export async function fetchSettingsView(): Promise<PlatformSettingsView> {
  await delay();
  return clone(settingsView);
}
