import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Text2SQL Demo",
  description: "Text2SQL 学习演示平台"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className="font-sans">
      <body className="theme">{children}</body>
    </html>
  );
}
