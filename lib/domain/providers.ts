/**
 * ID・時刻の提供者。Decision Tree / Engine に注入して出力を再現可能にする。
 */
export interface DomainProviders {
  generateId: () => string;
  now: () => Date;
}

/** 実行環境用の既定実装（テストでは固定値の実装を注入する） */
export const defaultProviders: DomainProviders = {
  generateId: () => crypto.randomUUID(),
  now: () => new Date(),
};
