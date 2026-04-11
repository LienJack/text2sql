"use client";

import { BookOpen, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StateBlock } from "@/components/ui/state-block";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { type GlossaryTerm, fetchGlossaryTerms } from "@/lib/platform-mock-adapter";

export default function GlossaryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await fetchGlossaryTerms();
        if (!active) {
          return;
        }
        setTerms(data);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "加载术语库失败");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const filteredTerms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return terms;
    }
    return terms.filter((term) =>
      `${term.term} ${term.synonyms.join(" ")} ${term.description}`.toLowerCase().includes(keyword)
    );
  }, [query, terms]);

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-[1400px] flex-col gap-4 bg-[var(--surface-page)] p-4 sm:p-6">
      <section className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:flex sm:items-center sm:justify-between sm:space-y-0">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">业务术语库</h2>
          <p className="text-sm text-[var(--text-secondary)]">统一业务术语和同义词，提高问数理解准确性。</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-tertiary)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="搜索术语或同义词"
            />
          </div>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                新增术语
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>新增术语</SheetTitle>
                <SheetDescription>添加标准术语、同义词与作用范围。</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 py-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">术语名称</label>
                  <Input placeholder="例如：活跃用户(DAU)" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">同义词</label>
                  <Input placeholder="例如：日活, 每日活跃用户" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">定义</label>
                  <textarea
                    className="h-28 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-panel)] p-3 text-sm text-[var(--text-primary)] outline-none focus:border-ring focus:ring-3 focus:ring-ring/30"
                    placeholder="输入业务定义或计算逻辑..."
                  />
                </div>
              </div>
              <SheetFooter>
                <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                  取消
                </Button>
                <Button onClick={() => setDrawerOpen(false)}>保存</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-panel)] shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
        {loading ? <StateBlock variant="loading" className="m-4">正在加载术语数据...</StateBlock> : null}
        {error ? <StateBlock variant="error" className="m-4">{error}</StateBlock> : null}
        {!loading && !error && filteredTerms.length === 0 ? (
          <StateBlock variant="idle" className="m-4">暂无匹配术语。</StateBlock>
        ) : null}

        {!loading && !error && filteredTerms.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">术语</TableHead>
                <TableHead className="w-[280px]">同义词</TableHead>
                <TableHead>定义</TableHead>
                <TableHead className="w-[140px] text-center">范围</TableHead>
                <TableHead className="w-[100px] text-center">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTerms.map((term) => (
                <TableRow key={term.id}>
                  <TableCell>
                    <div className="inline-flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                      <BookOpen className="h-4 w-4 text-[var(--action-primary)]" />
                      {term.term}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {term.synonyms.map((synonym) => (
                        <Badge key={synonym} variant="secondary">
                          {synonym}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-[var(--text-secondary)]">{term.description}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={term.scope === "全局" ? "default" : "outline"}>{term.scope}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={term.enabled}
                      onCheckedChange={(checked) =>
                        setTerms((previous) =>
                          previous.map((item) => (item.id === term.id ? { ...item, enabled: checked } : item))
                        )
                      }
                      aria-label={`切换术语 ${term.term} 状态`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>
    </div>
  );
}
