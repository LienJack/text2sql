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

export function SqlResultTable({ run }: SqlResultTableProps) {
  const columns = run.columns ?? [];
  const rows = run.rows ?? [];
  if (columns.length === 0 || rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        当前无结果数据。
      </p>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-md border">
      <Table className="min-w-lg">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 20).map((row, rowIndex) => (
            <TableRow key={`row-${rowIndex}`}>
              {columns.map((column) => (
                <TableCell key={`${rowIndex}-${column}`}>{String(row[column] ?? "")}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
