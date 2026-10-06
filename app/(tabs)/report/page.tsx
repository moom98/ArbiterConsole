export default function ReportPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">インシデント報告</h1>

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
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p>インシデント報告機能は開発中です</p>
        <p className="text-sm mt-2">Milestone 2で実装予定</p>
      </div>
    </div>
  );
}
