/**
 * テキストをファイルとしてダウンロードさせる（ブラウザ専用）。
 * 生成した Object URL はダウンロード開始後に解放する。
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType = "text/csv;charset=utf-8"
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // クリック直後に解放すると一部ブラウザでダウンロードが失敗するため次のタスクで解放
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
