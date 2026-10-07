/**
 * インメモリのトークンバケット（クライアントキー単位）。ADR-006。
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

/** 計画どおり 10 req/min（分類・推論の両ルートで共有） */
export const LLM_RATE_LIMIT_PER_MINUTE = 10;

export const sharedLlmRateLimiter = new TokenBucketRateLimiter({
  capacity: LLM_RATE_LIMIT_PER_MINUTE,
  refillIntervalMs: 60_000,
});

/**
 * クライアントキー（IP）。信頼できるリバースプロキシ（Vercel 等）が付与する
 * X-Forwarded-For の先頭を使う。プロキシを経由しない構成ではヘッダーを偽装できるため、
 * レート制限は乱用抑止にとどまる。
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.slice(0, 100);
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 100);
  return "unknown";
}
