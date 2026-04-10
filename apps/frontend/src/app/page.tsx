import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

export default function HomePage() {
  return (
    <AppShell
      title="Text2SQL 学习演示平台"
      description="通过自然语言提问，体验从消息到 SQL 预览与结果返回的完整链路。"
      className="items-center justify-center"
    >
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>准备开始演示</CardTitle>
          <CardDescription>系统会自动创建会话并加载聊天面板。</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          本次重写使用 React + shadcn-ui 统一页面与状态表达，确保后续迭代保持一致性。
        </CardContent>
        <CardFooter>
          <Link href="/chat" className={buttonVariants()}>
            进入 Text2SQL 演示页
          </Link>
        </CardFooter>
      </Card>
    </AppShell>
  );
}
