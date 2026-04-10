import { Injectable } from "@nestjs/common";
import { AppConfigService } from "../config/app-config.service";

export interface SqlDraft {
  provider: string;
  sql: string;
  explanation: string;
}

@Injectable()
export class ProviderRouterService {
  private readonly forbiddenIntent = /\b(delete|update|insert|drop|alter|truncate)\b/i;

  constructor(private readonly config: AppConfigService) {}

  async generateSql(question: string): Promise<SqlDraft> {
    const questionLower = question.toLowerCase();
    const provider = this.config.llmProvider;

    if (this.forbiddenIntent.test(questionLower)) {
      return {
        provider,
        sql: "DELETE FROM orders WHERE id = 1;",
        explanation: "检测到写操作意图，生成结果将由安全护栏拒绝。"
      };
    }

    if (questionLower.includes("退款")) {
      return {
        provider,
        sql: [
          "SELECT refund_type, COUNT(*) AS refund_count, ROUND(SUM(amount), 2) AS refund_amount",
          "FROM refunds",
          "GROUP BY refund_type",
          "ORDER BY refund_amount DESC"
        ].join(" "),
        explanation: "统计退款类型分布及退款总额，便于定位退款结构。"
      };
    }

    if (questionLower.includes("支付")) {
      return {
        provider,
        sql: [
          "SELECT method, status, COUNT(*) AS payment_count, ROUND(SUM(amount), 2) AS payment_amount",
          "FROM payments",
          "GROUP BY method, status",
          "ORDER BY payment_amount DESC"
        ].join(" "),
        explanation: "按支付方式与状态汇总支付笔数和金额。"
      };
    }

    if (questionLower.includes("发货") || questionLower.includes("物流")) {
      return {
        provider,
        sql: [
          "SELECT status, COUNT(*) AS shipment_count",
          "FROM shipments",
          "GROUP BY status",
          "ORDER BY shipment_count DESC"
        ].join(" "),
        explanation: "统计发货状态分布，快速识别履约进度。"
      };
    }

    if (questionLower.includes("商家")) {
      return {
        provider,
        sql: [
          "SELECT m.name AS merchant_name, COUNT(o.id) AS order_count, ROUND(SUM(o.total_amount), 2) AS total_gmv",
          "FROM merchants m",
          "JOIN orders o ON o.merchant_id = m.id",
          "GROUP BY m.id, m.name",
          "ORDER BY total_gmv DESC"
        ].join(" "),
        explanation: "按商家汇总订单数与交易额，用于排名分析。"
      };
    }

    return {
      provider,
      sql: [
        "SELECT status, COUNT(*) AS order_count, ROUND(SUM(total_amount), 2) AS total_amount",
        "FROM orders",
        "GROUP BY status",
        "ORDER BY total_amount DESC"
      ].join(" "),
      explanation: "默认给出订单状态的数量和金额分布，作为基础经营视图。"
    };
  }
}

