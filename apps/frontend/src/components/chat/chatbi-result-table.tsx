"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { StateBlock } from "@/components/ui/state-block";

export interface ChatBIResultTableData {
  columns: string[];
  rowsPreview: Array<Record<string, unknown>>;
  rowCount: number;
  previewRowCount?: number;
  truncated?: boolean;
}

interface ChatBIResultTableProps {
  table?: ChatBIResultTableData;
}

function isNumericValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (isNumericValue(value)) {
    return value.toLocaleString();
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ChatBIResultTable({ table }: ChatBIResultTableProps) {
  if (!table) {
    return <StateBlock variant="idle">暂无可展示的表格预览。</StateBlock>;
  }

  const columns = table.columns.length > 0
    ? table.columns
    : Object.keys(table.rowsPreview[0] ?? {});
  const rows = table.rowsPreview;

  if (columns.length === 0 || rows.length === 0) {
    return <StateBlock variant="idle">结果为空，未返回可展示行。</StateBlock>;
  }

  const previewCount = table.previewRowCount ?? rows.length;
  const totalCount = table.rowCount;
  const truncated = table.truncated ?? previewCount < totalCount;

  return (
    <section className="space-y-2" aria-label="Table 结果分区">
      <p className="text-xs text-[var(--text-secondary)]">
        预览 {previewCount} 行 / 总计 {Math.max(totalCount, previewCount)} 行
        {truncated ? "（已截断）" : ""}
      </p>
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-panel)]">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={`chatbi-row-${rowIndex}`}>
                {columns.map((column) => {
                  const value = row[column];
                  return (
                    <TableCell
                      key={`${column}-${rowIndex}`}
                      className={isNumericValue(value) ? "text-right" : undefined}
                    >
                      {formatCellValue(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
