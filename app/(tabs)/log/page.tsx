export default function LogPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">インシデント履歴</h1>

      <div className="text-center py-12 text-gray-500">
        <svg
          className="w-16 h-16 mx-auto mb-4 text-gray-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p>インシデント履歴はまだありません</p>
        <p className="text-sm mt-2">Milestone 3で実装予定</p>
      </div>
    </div>
  );
}
