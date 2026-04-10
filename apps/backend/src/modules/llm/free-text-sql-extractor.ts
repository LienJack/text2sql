import { Injectable } from "@nestjs/common";
import { DomainError } from "../../common/domain-error";

export interface ExtractedSql {
  sql: string;
  explanation: string;
}

@Injectable()
export class FreeTextSqlExtractor {
  extract(rawText: string): ExtractedSql {
    const sqlFromCodeBlock = this.extractFromCodeBlock(rawText);
    if (sqlFromCodeBlock) {
      return {
        sql: this.normalizeSql(sqlFromCodeBlock),
        explanation: this.cleanExplanation(rawText)
      };
    }

    const sqlFromInline = this.extractFromInline(rawText);
    if (sqlFromInline) {
      return {
        sql: this.normalizeSql(sqlFromInline),
        explanation: this.cleanExplanation(rawText)
      };
    }

    throw new DomainError(
      "LLM_SQL_EXTRACT_FAILED",
      "LLM 输出中未提取到可执行 SQL。",
      502,
      {
        rawText: rawText.slice(0, 1000)
      }
    );
  }

  private extractFromCodeBlock(rawText: string): string | null {
    const match = rawText.match(/```(?:sql)?\s*([\s\S]*?)```/i);
    if (!match?.[1]) {
      return null;
    }
    return match[1].trim();
  }

  private extractFromInline(rawText: string): string | null {
    const match = rawText.match(/((?:with|select)\b[\s\S]*?)(?:;|$)/i);
    if (!match?.[1]) {
      return null;
    }
    return match[1].trim();
  }

  private normalizeSql(sql: string): string {
    return `${sql.replace(/;+\s*$/, "")};`;
  }

  private cleanExplanation(rawText: string): string {
    return rawText
      .replace(/```(?:sql)?[\s\S]*?```/gi, "")
      .trim()
      .slice(0, 1500);
  }
}

