import { AppShell } from "@/components/app-shell";
import { ChatPanel } from "@/components/chat-panel";

export default function ChatPage() {
  return (
    <AppShell
      title="Text2SQL Chat Demo"
      description="输入业务问题，系统将展示会话消息、SQL 解释与执行结果。"
    >
      <ChatPanel />
    </AppShell>
  );
}
