export default function HomePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Arbiter Console</h1>
      <p className="text-gray-600 mb-8">
        チェス審判向けDecision Support アプリケーション
      </p>

      <div className="space-y-4">
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">クイックアクセス</h2>
          <div className="space-y-2">
            <a
              href="/report"
              className="block p-3 bg-blue-50 hover:bg-blue-100 rounded"
            >
              インシデント報告
            </a>
            <a
              href="/search"
              className="block p-3 bg-blue-50 hover:bg-blue-100 rounded"
            >
              ルール検索
            </a>
            <a
              href="/log"
              className="block p-3 bg-blue-50 hover:bg-blue-100 rounded"
            >
              履歴確認
            </a>
          </div>
        </div>

        <div className="bg-yellow-50 rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-2">注意事項</h2>
          <ul className="text-sm text-gray-700 space-y-1">
            <li>
              • このアプリはDecision
              Supportツールです。最終判断は審判が行います。
            </li>
            <li>• 重要な判定は必ずChief Arbiterへ相談してください。</li>
            <li>• 不正検出は自動化されません。必ず人間が判断します。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
