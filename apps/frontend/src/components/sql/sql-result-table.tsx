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
      <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
        当前无结果数据。
      </p>
    );
  }

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-200">
      <Table className="min-w-lg bg-white">
        <TableHeader className="bg-slate-50">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} className="font-semibold text-slate-900">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 20).map((row, rowIndex) => (
            <TableRow key={`row-${rowIndex}`}>
              {columns.map((column) => (
                <TableCell key={`${rowIndex}-${column}`} className="font-mono text-xs text-slate-700">
                  {String(row[column] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
