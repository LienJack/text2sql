import type { SqlRun } from "@text2sql/shared-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

interface SqlResultTableProps {
  run: SqlRun;
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number.isFinite(Number(value));
  }
  return false;
}

export function SqlResultTable({ run }: SqlResultTableProps) {
  const columns = run.columns ?? [];
  const rows = run.rows ?? [];
  if (columns.length === 0 || rows.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        当前无结果数据。
      </p>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-[12px] border border-[var(--border-default)]">
      <Table className="min-w-lg bg-[var(--surface-panel)]">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 20).map((row, rowIndex) => (
            <TableRow key={`row-${rowIndex}`}>
              {columns.map((column) => {
                const value = row[column];
                const alignClass = isNumericValue(value) ? "text-right" : "text-left";
                return (
                  <TableCell key={`${rowIndex}-${column}`} className={`font-mono text-xs ${alignClass}`}>
                    {String(value ?? "")}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
