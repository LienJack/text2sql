"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MessageComposerProps {
  value: string;
  disabled: boolean;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function MessageComposer({
  value,
  disabled,
  loading,
  onChange,
  onSubmit
}: MessageComposerProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如：近30天支付方式分布"
        aria-label="聊天输入"
      />
      <Button type="submit" disabled={disabled} className="sm:w-auto">
        {loading ? "发送中..." : "发送"}
      </Button>
    </form>
  );
}
