/**
 * 外部AIへ送らなかった理由の表示（external-ai-data-protection.md §4.3）。純粋関数。
 * 理由はコードだけを扱い、本文は含めない。
 */
import type { GateReasonCode } from "@/lib/domain/privacy";

const REASON_LABELS: Record<GateReasonCode, string> = {
  "explicit-fair-play": "フェアプレー（不正）のカテゴリ",
  "arbiter-opt-out": "「外部AIに送らない」がオン",
  "fair-play": "フェアプレー（不正）に関する記述",
  health: "健康・医療に関する記述",
  harassment: "ハラスメント・暴力などに関する記述",
  crime: "盗難・警察などに関する記述",
  religion: "宗教・信条に関する記述",
  "family-minors": "家庭・未成年に関する記述",
  english: "機微な内容の可能性がある英語の記述",
  "context-sensitive": "機微な内容に関する記述",
  "context-uncertain": "機微な内容か判断できない記述",
  "unknown-vocabulary": "判断できない語を含む記述",
  unanalyzable: "解析できない文字が多い",
  "mostly-latin": "英字が主の記述",
  "too-long": "記述が長すぎる",
  residual: "名前・番号などを取り除けない",
};

/** 理由コードの表示名（重複を除き、出現順） */
export function gateReasonLabels(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    const label =
      REASON_LABELS[code as GateReasonCode] ?? "機微な内容の可能性がある";
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** 「外部AIには送信していません（理由: …）」 */
export function notSentNotice(codes: readonly string[]): string {
  const labels = gateReasonLabels(codes);
  return `外部AIには送信していません（理由: ${
    labels.length > 0 ? labels.join("、") : "機微な内容の可能性がある"
  }）`;
}
