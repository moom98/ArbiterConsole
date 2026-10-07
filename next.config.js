const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
  // モデル・WASMは大きく（数十〜百MB超）precacheに含めない。初回利用時に
  // 下記の runtimeCaching (CacheFirst) でキャッシュしオフラインでも利用する。
  publicExcludes: ["!noprecache/**/*", "!models/**/*", "!ort/**/*"],
  // LLM（ADR-007）: 同一オリジンの POST /api/llm/* のみ。Workbox の runtimeCaching は GET のみを
  // 対象とし、さらに下の "others" ルールで /api/ を除外しているため応答はキャッシュされない。
  // /api/ をキャッシュするルールを追加しないこと
  runtimeCaching: [
    {
      // 埋め込みモデル（Transformers.js, 同一オリジン /models/）
      urlPattern: ({ url }) =>
        self.origin === url.origin && url.pathname.startsWith("/models/"),
      handler: "CacheFirst",
      options: {
        cacheName: "embedding-model",
        expiration: { maxEntries: 16 },
        cacheableResponse: { statuses: [200] },
      },
    },
    {
      // onnxruntime-web の WASM（同一オリジン /ort/）
      urlPattern: ({ url }) =>
        self.origin === url.origin && url.pathname.startsWith("/ort/"),
      handler: "CacheFirst",
      options: {
        cacheName: "onnx-wasm",
        expiration: { maxEntries: 8 },
        cacheableResponse: { statuses: [200] },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "google-fonts-webfonts",
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
      },
    },
    {
      urlPattern: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-font-assets",
        expiration: {
          maxEntries: 4,
          maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
        },
      },
    },
    {
      urlPattern: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-image-assets",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\/_next\/image\?url=.+$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "next-image",
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\.(?:mp3|wav|ogg)$/i,
      handler: "CacheFirst",
      options: {
        rangeRequests: true,
        cacheName: "static-audio-assets",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\.(?:js)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-js-assets",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\.(?:css|less)$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "static-style-assets",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\/_next\/data\/.+\/.+\.json$/i,
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "next-data",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: /\.(?:json|xml|csv)$/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "static-data-assets",
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
    {
      urlPattern: ({ url }) => {
        const isSameOrigin = self.origin === url.origin;
        if (!isSameOrigin) return false;
        const pathname = url.pathname;
        if (pathname.startsWith("/api/")) return false;
        return true;
      },
      handler: "NetworkFirst",
      options: {
        cacheName: "others",
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 32,
          maxAgeSeconds: 24 * 60 * 60, // 1 day
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Gemini SDK はサーバー（Route Handler）専用。webpack でバンドルせず Node から読み込む（ADR-007）
    serverComponentsExternalPackages: ["@google/genai"],
  },
  webpack: (config, { isServer }) => {
    // Transformers.jsはブラウザ専用とするため、サーバー側ではonnxruntime-nodeを除外
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "onnxruntime-node": "commonjs onnxruntime-node",
        "@xenova/transformers": "commonjs @xenova/transformers",
      });
    }

    // .nodeファイルをignore
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.node$/,
      use: "ignore-loader",
    });

    // pdfjs-distのworker設定
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias.canvas = false;

    return config;
  },
};

module.exports = withPWA(nextConfig);
