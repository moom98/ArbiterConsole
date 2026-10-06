import { ReactNode } from "react";
import { TabBar } from "@/components/ui/TabBar";

interface TabLayoutProps {
  children: ReactNode;
}

/**
 * ページ全体をスクロールさせ（内部スクロールにしない）、タブバーは下部に固定する。
 * h-screen は iOS Safari でツールバー分はみ出すため、dvh の min-height を使う。
 */
export default function TabLayout({ children }: TabLayoutProps) {
  return (
    <div className="flex flex-col min-h-screen min-h-dvh pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <main className="flex-1">{children}</main>
      <TabBar />
    </div>
  );
}
