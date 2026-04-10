"use client";

import type { SqlRun } from "@text2sql/shared-types";

interface Props {
  run: SqlRun | null;
}

export function SqlPreview({ run }: Props) {
  if (!run) {
    return (
      <section style={{ padding: 16, border: "1px solid #d0d5dd", borderRadius: 8 }}>
        暂无 SQL 预览
      </section>
    );
  }

  return (
    <section
      style={{
        padding: 16,
        border: "1px solid #d0d5dd",
        borderRadius: 8,
        background: "#fff"
      }}
    >
      <h3 style={{ marginTop: 0 }}>SQL 解释与执行结果</h3>
      <p>
        <strong>状态：</strong>
        {run.status}
      </p>
      <p>
        <strong>解释：</strong>
        {run.explanation ?? "-"}
      </p>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          background: "#f8fafc",
          padding: 12,
          borderRadius: 6
        }}
      >
        {run.sql ?? "暂无 SQL"}
      </pre>
      {run.error ? (
        <p style={{ color: "#b42318" }}>
          <strong>错误：</strong>
          {run.error}
        </p>
      ) : null}
      {run.rows && run.rows.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {(run.columns ?? []).map((column) => (
                  <th
                    key={column}
                    style={{
                      borderBottom: "1px solid #e4e7ec",
                      textAlign: "left",
                      padding: "8px 6px"
                    }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {run.rows.slice(0, 20).map((row, index) => (
                <tr key={`row-${index}`}>
                  {(run.columns ?? []).map((column) => (
                    <td
                      key={`${index}-${column}`}
                      style={{
                        borderBottom: "1px solid #f2f4f7",
                        padding: "8px 6px"
                      }}
                    >
                      {String(row[column] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

