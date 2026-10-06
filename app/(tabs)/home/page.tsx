import Link from "next/link";

const QUICK_LINKS = [
  { href: "/report", label: "インシデント報告" },
  { href: "/search", label: "ルール検索" },
  { href: "/log", label: "履歴確認" },
] as const;

export default function HomePage() {
  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-2xl font-bold mb-2">Arbiter Console</h1>
      <p className="text-gray-600 mb-6">
        チェス審判向け判断支援（Decision Support）アプリケーション
      </p>

      <div className="space-y-4">
        <section
          aria-labelledby="quick-access-title"
          className="bg-white rounded-lg shadow p-4"
        >
          <h2 id="quick-access-title" className="text-lg font-semibold mb-2">
            クイックアクセス
          </h2>
          <ul className="space-y-2">
            {QUICK_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex items-center min-h-12 px-3 bg-blue-50 hover:bg-blue-100 rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="notice-title"
          className="bg-yellow-50 rounded-lg shadow p-4"
        >
          <h2 id="notice-title" className="text-lg font-semibold mb-2">
            注意事項
          </h2>
          <ul className="text-sm text-gray-700 space-y-1 list-disc ml-5">
            <li>
              このアプリは判断支援（Decision
              Support）ツールです。表示されるのは推奨であり、最終的な裁定はアービターが行います。
            </li>
            <li>重要な判定は必ずChief Arbiterへ相談してください。</li>
            <li>不正検出は自動化されません。必ず人間が判断します。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
