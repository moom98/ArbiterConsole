"use client";

interface ExternalAiOptOutSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
}

/**
 * 「外部AIに送らない」（external-ai-data-protection.md §4.4）。既定はオフ。
 * オンなら、この報告の内容は分類・AI参考情報のどちらでも外部へ送らない（Sensitive Gate の L1）。
 */
export function ExternalAiOptOutSwitch({
  checked,
  onChange,
}: ExternalAiOptOutSwitchProps) {
  return (
    <label className="mt-2 flex min-h-12 items-center gap-3 text-sm text-gray-800">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5"
      />
      <span>
        外部AIに送らない
        <span className="block text-xs text-gray-500">
          健康・トラブルなど、送るべきでない内容のときはオンにしてください
        </span>
      </span>
    </label>
  );
}
