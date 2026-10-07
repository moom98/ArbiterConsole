/**
 * インメモリのトークンバケット（クライアントキー単位）。ADR-007。
 *
 * 制約: プロセス内のメモリにのみ保持するため、サーバーレス・複数インスタンス構成では
 * インスタンスごとに別のバケットになり、コールドスタートで消える。
 * 乱用の抑止（基本的なガード）であり、厳密なクォータではない。
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** allowed=false の場合、次のトークンが補充されるまでの秒数 */
  retryAfterSeconds: number;
}

export interface TokenBucketOptions {
  /** バケット容量（バースト） */
  capacity: number;
  /** refillIntervalMs ごとに capacity まで線形に補充する */
  refillIntervalMs: number;
  now?: () => number;
  /** 保持するキーの上限（超えた場合は満タンのバケットから削除） */
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly ratePerMs: number;
  private readonly maxKeys: number;

  constructor(private readonly options: TokenBucketOptions) {
    this.now = options.now ?? Date.now;
    this.ratePerMs = options.capacity / options.refillIntervalMs;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  take(key: string): RateLimitDecision {
    const now = this.now();
    const bucket = this.refill(key, now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const waitMs = (1 - bucket.tokens) / this.ratePerMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  }

  private refill(key: string, now: number): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.prune(now);
      bucket = { tokens: this.options.capacity, updatedAt: now };
      this.buckets.set(key, bucket);
      return bucket;
    }
    const elapsed = Math.max(0, now - bucket.updatedAt);
    bucket.tokens = Math.min(
      this.options.capacity,
      bucket.tokens + elapsed * this.ratePerMs
    );
    bucket.updatedAt = now;
    return bucket;
  }

  private prune(now: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [key, b] of Array.from(this.buckets.entries())) {
      const tokens = b.tokens + (now - b.updatedAt) * this.ratePerMs;
      if (tokens >= this.options.capacity) this.buckets.delete(key);
    }
    // それでも多すぎる場合は古いものから削除する
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/**
 * プロセス全体の1日あたりの上限（UTC 日付で集計）。費用の暴走を防ぐ最後の歯止め。
 * インメモリのためインスタンスごと・再起動でリセットされる。厳密な上限は
 * Google Cloud 側のクォータ・予算アラートで設定すること（ADR-007）。
 */
export class DailyRequestCounter {
  private day = "";
  private count = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** 1件を消費する。limit 0 は無制限 */
  take(limit: number): boolean {
    if (limit <= 0) return true;
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= limit) return false;
    this.count++;
    return true;
  }
}

/**
 * クライアントキー。
 * - trustProxy（TRUST_PROXY=1）: 信頼できるリバースプロキシ（Vercel 等）が付与する
 *   X-Forwarded-For の先頭（なければ X-Real-IP）を使う
 * - それ以外: ヘッダーは偽装できるため使わず、プロセス全体で1つのバケットを共有する
 *   （全利用者の合計に対する制限になる。ADR-007）
 */
export function clientKey(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return "process";
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return `ip:${first.slice(0, 100)}`;
  const real = headers.get("x-real-ip")?.trim();
  if (real) return `ip:${real.slice(0, 100)}`;
  return "process";
}
