import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";

// 全テストの並列実行時は IndexedDB（fake-indexeddb）を使う画面の描画が 1 秒を超えることがある
configure({ asyncUtilTimeout: 5000 });
