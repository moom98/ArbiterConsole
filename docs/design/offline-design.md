# Offline Strategy Design

**Version:** 1.0
**Last Updated:** 2026-10-06
**Status:** Draft

---

## 1. Overview

Arbiter Console must function in **poor or no network connectivity** environments (§31). Tournament venues often have:
- Weak WiFi signals
- Crowded networks (hundreds of players/spectators)
- No internet access in remote locations
- Intermittent connectivity

This document specifies the **offline-first architecture** to ensure arbiters can perform critical functions without internet.

---

## 2. Requirements Summary

### From Product Requirements

**§31: Offline Requirements**

Must work offline:
- ✅ Tournament Profile
- ✅ Laws本文検索 (full-text search)
- ✅ Tournament Regulations
- ✅ Incident Log閲覧 (view)
- ✅ Incident Log登録 (create)
- ✅ Round Checklist
- ✅ Clock Operation Guide

May require internet:
- ⚠️ AI自然言語解析 (LLM reasoning)

**Critical Constraint**:
> 基本的なルール検索と定型Decision Treeは通信不能でも利用できること

**§33: Performance Requirements**
- Rule search: <3s (offline must meet this too)
- Decision Tree: <100ms

### From Architecture & ADR-002

**Offline-capable Components**:
- Decision Trees (10 deterministic incident types)
- Vector search (pre-computed embeddings)
- Full-text search (Lunr.js)
- IndexedDB storage

**Requires Internet**:
- LLM reasoning (Claude API)
- Embedding generation for new documents (fallback: full-text only)

---

## 3. Offline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Service Worker                          │
│                    (PWA Caching Strategy)                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Static Assets Cache (App Shell)                          │  │
│  │  • HTML, CSS, JS bundles                                  │  │
│  │  • Digital Agency Design System fonts                     │  │
│  │  • Icons, images                                          │  │
│  │  • Decision Tree logic (bundled in JS)                    │  │
│  │  Strategy: Cache-first                                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  API Response Cache (Optional)                             │  │
│  │  • LLM responses (1 hour TTL)                              │  │
│  │  • Embedding generation results                            │  │
│  │  Strategy: Network-first, fallback to cache               │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         IndexedDB                                │
│                    (Primary Data Store)                          │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │  Tournaments     │  │  RuleSources     │  │  Incidents     │ │
│  │  Rounds          │  │  Articles        │  │  Penalties     │ │
│  │  Games           │  │  Embeddings      │  │  Decisions     │ │
│  │  Players         │  │  Regulations     │  │  Checklists    │ │
│  └──────────────────┘  └──────────────────┘  └────────────────┘ │
│                                                                   │
│  Total Storage: ~50-200MB (varies by rule document count)        │
│  Quota Management: User can clear old tournaments/rules          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    In-Memory Indexes                             │
│                    (Loaded on App Start)                         │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐                     │
│  │  Lunr.js Index   │  │  Vector Index    │                     │
│  │  (Full-text)     │  │  (Embeddings)    │                     │
│  │  ~5-10MB RAM     │  │  ~10-30MB RAM    │                     │
│  └──────────────────┘  └──────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Application Logic                             │
│  • Decision Engine (routes to Tree or LLM)                       │
│  • Decision Trees (pure TypeScript, no network)                  │
│  • Rule Retrieval (local search)                                 │
│  • Incident Logger (local write, background sync)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. PWA Configuration

### 4.1 Service Worker Strategy

**Using**: `next-pwa` with Workbox

**Configuration**:
```javascript
// next.config.js
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    // Static assets (App Shell)
    {
      urlPattern: /^https?:\/\/[^/]+\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: {
          maxEntries: 64,
          maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
        },
      },
    },

    // API calls to Claude (optional caching)
    {
      urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'anthropic-api',
        networkTimeoutSeconds: 10,
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 60, // 1 hour
        },
        cacheableResponse: {
          statuses: [200],
        },
      },
    },

    // Images and fonts
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|woff|woff2)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-resources',
        expiration: {
          maxEntries: 128,
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        },
      },
    },
  ],
});

module.exports = withPWA({
  // Next.js config
});
```

### 4.2 Manifest Configuration

**File**: `public/manifest.json`

```json
{
  "name": "Arbiter Console",
  "short_name": "Arbiter",
  "description": "Decision Support for Chess Tournament Arbiters",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1e40af",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ],
  "categories": ["sports", "utilities"],
  "screenshots": [
    {
      "src": "/screenshot-mobile.png",
      "sizes": "750x1334",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ]
}
```

### 4.3 Installation Prompt

**Trigger**: After user completes first incident report (demonstrates value)

```typescript
class PWAInstallPrompt {
  private deferredPrompt: any;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
    });
  }

  async showInstallPrompt(): Promise<boolean> {
    if (!this.deferredPrompt) return false;

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;

    this.deferredPrompt = null;
    return outcome === 'accepted';
  }

  isInstalled(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches ||
           (window.navigator as any).standalone === true;
  }
}
```

---

## 5. IndexedDB Schema & Storage

### 5.1 Database Schema

**Implementation**: Dexie.js (per ADR-001)

```typescript
import Dexie, { Table } from 'dexie';

class ArbiterDatabase extends Dexie {
  // Domain entities
  tournaments!: Table<Tournament>;
  rounds!: Table<Round>;
  games!: Table<Game>;
  players!: Table<Player>;

  // Incidents & Decisions
  incidents!: Table<Incident>;
  penalties!: Table<Penalty>;

  // Rules
  ruleSources!: Table<RuleSource>;
  articles!: Table<Article>;
  embeddings!: Table<ArticleEmbedding>;
  tournamentRegulations!: Table<TournamentRegulation>;

  // Sync metadata
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('ArbiterConsole');

    this.version(1).stores({
      tournaments: 'id, name, date, status',
      rounds: 'id, tournamentId, roundNumber, status',
      games: 'id, roundId, boardNumber, status',
      players: 'id, name, teamId',

      incidents: 'id, gameId, timestamp, category, escalatedToCA, [gameId+timestamp]',
      penalties: 'id, incidentId, playerId, gameId, appliedAt',

      ruleSources: 'id, name, version, status, sourceType, [status+sourceType]',
      articles: 'id, sourceId, articleNumber, [sourceId+articleNumber]',
      embeddings: 'id, articleId',
      tournamentRegulations: 'id, tournamentId, category',

      syncQueue: '++id, entityType, entityId, action, syncStatus, createdAt'
    });
  }
}

export const db = new ArbiterDatabase();
```

### 5.2 Storage Size Estimates

| Data Type | Count (MVP) | Size per Item | Total Size |
|-----------|-------------|---------------|------------|
| RuleSources | 5 | 10 KB | 50 KB |
| Articles | 500 | 2 KB | 1 MB |
| Embeddings | 500 | 1.5 KB (384 floats) | 750 KB |
| Tournament Profile | 1 | 5 KB | 5 KB |
| Rounds | 10 | 2 KB | 20 KB |
| Games | 100 | 1 KB | 100 KB |
| Incidents | 50 | 3 KB | 150 KB |
| **Total (Active Tournament)** | | | **~2-3 MB** |

**Multiple Tournaments**: If user manages 5 past tournaments → ~10-15 MB total

**Browser Limits**:
- Chrome: 60% of available disk space (typically GB)
- Safari: 1 GB (iOS may prompt user)
- Firefox: 50% of available disk space

**Mitigation**: User can clear old tournament data via settings

### 5.3 Data Compression

**For Embeddings** (largest data type):

```typescript
// Option 1: Float32 → Int8 quantization (reduces size by 75%)
function quantizeEmbedding(embedding: number[]): Int8Array {
  // Normalize to [-1, 1], then scale to [-127, 127]
  const min = Math.min(...embedding);
  const max = Math.max(...embedding);
  const range = max - min;

  return new Int8Array(
    embedding.map(v => Math.round(((v - min) / range * 2 - 1) * 127))
  );
}

function dequantizeEmbedding(quantized: Int8Array): number[] {
  return Array.from(quantized).map(v => v / 127);
}

// Embedding storage: 384 floats * 4 bytes = 1536 bytes
// Compressed: 384 bytes (75% reduction)
```

**Trade-off**: Slight loss in search accuracy (~1-2% drop in recall@10)
- **Recommendation**: Use compression for mobile devices with low storage

---

## 6. Offline Data Lifecycle

### 6.1 Initial Setup (First Launch)

```
1. User opens app (online)
2. App downloads and caches:
   a. Static assets (Next.js bundles, design system)
   b. Service worker
   c. Embedding model (Transformers.js, ~23MB)
3. Admin uploads FIDE Laws PDF
4. App processes:
   a. Extract articles
   b. Generate embeddings (takes ~2-5min for 500 articles)
   c. Build Lunr.js index
   d. Store in IndexedDB
5. App ready for offline use

Total download: ~30-40 MB (first time)
Subsequent launches: <1s (cached)
```

**Progress Indicator**:
```tsx
<SetupProgress>
  <Step status="completed">静的リソースをダウンロード中...</Step>
  <Step status="completed">埋め込みモデルをロード中...</Step>
  <Step status="in-progress">ルール資料を処理中... (150/500)</Step>
  <Step status="pending">検索インデックスを構築中...</Step>
</SetupProgress>
```

### 6.2 Tournament Creation (Offline)

```typescript
class TournamentService {
  async createTournament(data: TournamentInput): Promise<Tournament> {
    const tournament: Tournament = {
      id: uuid(),
      ...data,
      createdAt: new Date(),
      status: 'draft'
    };

    // Save locally
    await db.tournaments.add(tournament);

    // Queue for sync (when online)
    await this.queueSync('create', 'tournament', tournament.id);

    return tournament;
  }

  private async queueSync(
    action: 'create' | 'update' | 'delete',
    entityType: string,
    entityId: string
  ) {
    await db.syncQueue.add({
      entityType,
      entityId,
      action,
      syncStatus: 'pending',
      createdAt: new Date()
    });
  }
}
```

**All write operations**:
1. Write to IndexedDB immediately (optimistic UI)
2. Queue for background sync
3. Sync when online (if backend exists)

### 6.3 Incident Logging (Offline)

**Per §31**: Incident Log登録 must work offline

```typescript
class IncidentService {
  async logIncident(
    incident: IncidentInput,
    decision: Decision
  ): Promise<Incident> {
    const incidentRecord: Incident = {
      id: uuid(),
      ...incident,
      decision,
      timestamp: new Date(),
      resolvedAt: decision ? new Date() : undefined,
      // Metadata for sync
      _syncStatus: 'pending',
      _createdOffline: !navigator.onLine
    };

    // Save locally
    await db.incidents.add(incidentRecord);

    // Queue for sync
    if (navigator.onLine) {
      this.syncIncident(incidentRecord.id);
    } else {
      await db.syncQueue.add({
        entityType: 'incident',
        entityId: incidentRecord.id,
        action: 'create',
        syncStatus: 'pending',
        createdAt: new Date()
      });
    }

    return incidentRecord;
  }
}
```

**UI Feedback**:
- Offline-created incidents show badge: "ローカル保存" (gray)
- After sync: badge changes to "同期済み" (green)

---

## 7. Background Sync

**Using**: Background Sync API (when available)

```typescript
class BackgroundSyncService {
  async registerSync(tag: string) {
    if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register(tag);
    } else {
      // Fallback: Sync immediately when online
      window.addEventListener('online', () => this.syncNow());
    }
  }

  async syncNow() {
    const queue = await db.syncQueue
      .where('syncStatus')
      .equals('pending')
      .toArray();

    for (const item of queue) {
      try {
        await this.syncItem(item);
        await db.syncQueue.update(item.id, { syncStatus: 'synced' });
      } catch (error) {
        await db.syncQueue.update(item.id, {
          syncStatus: 'failed',
          errorMessage: error.message
        });
      }
    }
  }

  private async syncItem(item: SyncQueueItem) {
    // Future: Send to backend
    // For MVP: No backend, so just mark as synced locally
    console.log(`Syncing ${item.entityType} ${item.entityId}`);
  }
}
```

**Service Worker** (in `public/sw.js` or auto-generated by next-pwa):
```javascript
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-incidents') {
    event.waitUntil(syncIncidents());
  }
});

async function syncIncidents() {
  // Communicate with main app to trigger sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'BACKGROUND_SYNC',
      tag: 'sync-incidents'
    });
  });
}
```

---

## 8. Network Status Handling

### 8.1 Online/Offline Detection

```typescript
class NetworkStatus {
  private listeners: ((online: boolean) => void)[] = [];

  constructor() {
    window.addEventListener('online', () => this.notify(true));
    window.addEventListener('offline', () => this.notify(false));
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  async checkConnectivity(): Promise<boolean> {
    if (!navigator.onLine) return false;

    try {
      // Ping a reliable endpoint
      await fetch('https://api.anthropic.com/v1/health', {
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors'
      });
      return true;
    } catch {
      return false;
    }
  }

  subscribe(listener: (online: boolean) => void) {
    this.listeners.push(listener);
  }

  private notify(online: boolean) {
    this.listeners.forEach(listener => listener(online));
  }
}
```

### 8.2 UI Indicators

**Status Bar Component**:
```tsx
function NetworkStatusBar() {
  const isOnline = useNetworkStatus();

  if (isOnline) {
    return (
      <div className="status-bar status-online">
        <WifiIcon /> オンライン
      </div>
    );
  }

  return (
    <div className="status-bar status-offline">
      <WifiOffIcon /> オフライン
      <span className="info">一部機能（AI分析）が制限されています</span>
    </div>
  );
}
```

**Inline Warnings**:
```tsx
function IncidentReportForm() {
  const isOnline = useNetworkStatus();

  return (
    <form>
      {!isOnline && (
        <Alert severity="warning">
          オフラインモードです。Decision Treeによる自動裁定は利用できますが、
          AI分析は利用できません。複雑な事象はCAへ確認してください。
        </Alert>
      )}
      {/* Form fields */}
    </form>
  );
}
```

---

## 9. Graceful Degradation Strategy

### 9.1 Feature Matrix

| Feature | Online | Offline | Notes |
|---------|--------|---------|-------|
| Incident Report (Text) | ✅ | ✅ | Full functionality |
| Incident Report (Voice) | ✅ | ⚠️ | Web Speech API may work offline (browser-dependent) |
| Decision Tree Rulings | ✅ | ✅ | Fully deterministic, no network needed |
| LLM-based Reasoning | ✅ | ❌ | Requires Claude API |
| Rule Search (Vector) | ✅ | ✅ | Pre-computed embeddings |
| Rule Search (Full-text) | ✅ | ✅ | Lunr.js index |
| Incident Log (View) | ✅ | ✅ | IndexedDB |
| Incident Log (Create) | ✅ | ✅ | IndexedDB + background sync |
| Round Checklist | ✅ | ✅ | Local templates |
| Clock Guide | ✅ | ✅ | Static content |
| Tournament Profile | ✅ | ✅ | IndexedDB |
| Embedding New Docs | ✅ | ⚠️ | Transformers.js (slow but works) |

### 9.2 Offline Fallback for LLM Incidents

**When offline and incident requires LLM** (per ADR-002):

```typescript
async function handleIncidentOffline(
  incident: IncidentClassification
): Promise<Decision> {
  // Check if Decision Tree can handle it
  if (DECISION_TREE_CATEGORIES.includes(incident.category)) {
    return await executeDecisionTree(incident);
  }

  // Cannot process without LLM → Manual rule search + CA
  return {
    conclusion: "この事象は詳細な分析が必要です。",
    actions: [
      "「ルール検索」タブで関連規則を確認してください。",
      "以下のキーワードで検索してみてください：" + incident.keywords.join(', '),
      "インターネット接続を確認するか、CAへ相談してください。"
    ],
    intervention: 'consult-ca',
    penalties: [],
    sources: [],
    confidence: 'none',
    escalationRecommended: true,
    escalationReason: 'オフライン環境のため詳細分析ができません。',
    generatedBy: 'offline-fallback'
  };
}
```

**UI**:
```tsx
{decision.generatedBy === 'offline-fallback' && (
  <Alert severity="info">
    <AlertTitle>オフラインモード</AlertTitle>
    この事象はAI分析が必要ですが、オフライン環境のため利用できません。
    以下のルール検索を試すか、インターネット接続後に再度お試しください。

    <Button onClick={openRuleSearch}>
      ルール検索を開く
    </Button>
  </Alert>
)}
```

---

## 10. Data Sync Strategy (Future)

**Note**: MVP has no backend, so sync is local-only. This section plans for future backend integration.

### 10.1 Sync Modes

**Mode 1: Manual Sync** (MVP)
- User taps "同期" button
- App uploads pending incidents to server
- Downloads latest tournament data

**Mode 2: Auto Sync** (Future)
- Sync on app launch (if online)
- Sync every 5 minutes (if online and pending changes)
- Background sync when network restored

### 10.2 Conflict Resolution

**Scenario**: Two arbiters edit same incident offline

**Strategy**: Last-write-wins (LWW)
```typescript
interface Incident {
  id: string;
  // ... other fields
  version: number;  // Increments on each update
  updatedAt: Date;
  updatedBy: string;  // Arbiter ID
}

async function resolveConflict(
  local: Incident,
  remote: Incident
): Promise<Incident> {
  if (remote.updatedAt > local.updatedAt) {
    // Remote is newer → accept remote
    return remote;
  } else if (local.version > remote.version) {
    // Local has more edits → keep local, upload to server
    return local;
  } else {
    // Timestamp tie → escalate to manual resolution
    throw new ConflictError('Manual resolution required');
  }
}
```

**UI for Conflicts**:
```tsx
<ConflictResolutionDialog>
  <h3>データの競合が検出されました</h3>
  <p>別のアービターが同じIncidentを編集しています。</p>

  <CompareView>
    <div>
      <h4>あなたの変更</h4>
      {renderIncident(local)}
    </div>
    <div>
      <h4>他のアービターの変更</h4>
      {renderIncident(remote)}
    </div>
  </CompareView>

  <ButtonGroup>
    <Button onClick={() => acceptRemote()}>他のアービターの変更を採用</Button>
    <Button onClick={() => keepLocal()}>自分の変更を維持</Button>
  </ButtonGroup>
</ConflictResolutionDialog>
```

---

## 11. Performance Optimization

### 11.1 Lazy Loading

**Problem**: Loading all 500 articles + embeddings on app start is slow

**Solution**: Lazy load by category
```typescript
class LazyRuleLoader {
  private loadedCategories = new Set<string>();

  async ensureLoaded(category: IncidentCategory) {
    if (this.loadedCategories.has(category)) return;

    // Load only articles relevant to this category
    const articles = await db.articles
      .where('keywords')
      .anyOf(this.getCategoryKeywords(category))
      .toArray();

    // Load embeddings for these articles
    const embeddings = await db.embeddings
      .where('articleId')
      .anyOf(articles.map(a => a.id))
      .toArray();

    // Add to search indexes
    await this.vectorSearch.addArticles(embeddings);
    await this.fullTextSearch.addArticles(articles);

    this.loadedCategories.add(category);
  }

  private getCategoryKeywords(category: IncidentCategory): string[] {
    const map = {
      'illegal-move': ['illegal', 'move', '違法手', 'irregularity'],
      'clock-time': ['clock', 'time', '時計', 'flag'],
      // ... etc.
    };
    return map[category] || [];
  }
}
```

### 11.2 IndexedDB Query Optimization

**Use Compound Indexes** (defined in schema):
```typescript
this.version(1).stores({
  incidents: 'id, gameId, timestamp, [gameId+timestamp]',  // Compound index
  articles: 'id, sourceId, articleNumber, [sourceId+articleNumber]'
});

// Fast query:
const incidents = await db.incidents
  .where('[gameId+timestamp]')
  .between([gameId, minDate], [gameId, maxDate])
  .toArray();
```

### 11.3 Service Worker Cache Pruning

**Problem**: Cache grows unbounded

**Solution**: Limit cache size
```javascript
// In service worker
const MAX_CACHE_SIZE = 100; // MB

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();

          if (keys.length > MAX_CACHE_SIZE) {
            // Delete oldest entries
            const toDelete = keys.slice(0, keys.length - MAX_CACHE_SIZE);
            await Promise.all(toDelete.map(key => cache.delete(key)));
          }
        })
      );
    })
  );
});
```

---

## 12. Testing Offline Functionality

### 12.1 Manual Testing

**Chrome DevTools**:
1. Open DevTools → Network tab
2. Throttling: Set to "Offline"
3. Test incident reporting, rule search, etc.

**Lighthouse PWA Audit**:
```bash
npx lighthouse https://arbiter-console.app --view --preset=desktop
```

**Checklist**:
- ✅ App loads with offline network
- ✅ Service worker registers successfully
- ✅ Static assets cached
- ✅ Can create tournament offline
- ✅ Can log incident offline
- ✅ Rule search works offline
- ✅ Decision Trees execute offline
- ✅ LLM incidents show graceful fallback
- ✅ Sync queue persists across page refresh

### 12.2 Automated Testing

**E2E Test with Offline Mode**:
```typescript
// Using Playwright
test('should log incident offline', async ({ page, context }) => {
  // Go offline
  await context.setOffline(true);

  await page.goto('/');
  await page.click('text=トラブル報告');
  await page.fill('textarea', '黒が両手でキャスリングした');
  await page.click('button:has-text("決定を表示")');

  // Should show Decision Tree result
  await expect(page.locator('text=Blackの1回目のIllegal Move')).toBeVisible();

  // Should have queued for sync
  const syncQueue = await page.evaluate(() => {
    return indexedDB.databases();
  });
  expect(syncQueue.length).toBeGreaterThan(0);
});
```

---

## 13. User Education

### 13.1 First-Time Onboarding

**Offline Capability Explanation**:
```tsx
<OnboardingDialog step={3}>
  <h3>オフライン対応</h3>
  <p>
    Arbiter Consoleは、インターネット接続がない環境でも多くの機能を利用できます。
  </p>

  <FeatureList>
    <Feature icon="✅">
      <strong>オフラインで利用可能</strong>
      <ul>
        <li>ルール検索（全文検索・セマンティック検索）</li>
        <li>Decision Tree裁定（違法手、時間切れ等）</li>
        <li>Incident記録</li>
        <li>ラウンドチェックリスト</li>
      </ul>
    </Feature>

    <Feature icon="⚠️">
      <strong>インターネット接続が必要</strong>
      <ul>
        <li>AI分析（複雑な事象の詳細分析）</li>
        <li>新しいルール資料のアップロード</li>
      </ul>
    </Feature>
  </FeatureList>

  <Tip>
    大会開始前に、インターネット接続環境でアプリを開き、
    ルール資料がダウンロードされていることを確認してください。
  </Tip>
</OnboardingDialog>
```

### 13.2 Pre-Tournament Checklist

**Settings Panel**:
```tsx
<OfflineReadinessCheck>
  <h3>オフライン準備状況</h3>

  <CheckItem status="ok">
    <CheckIcon /> ルール資料：FIDE Laws 2023 (500 articles)
  </CheckItem>

  <CheckItem status="ok">
    <CheckIcon /> JCF NAセミナー資料 2025 (120 articles)
  </CheckItem>

  <CheckItem status="warning">
    <WarningIcon /> 大会固有規則：未登録
    <Button size="small">アップロード</Button>
  </CheckItem>

  <CheckItem status="ok">
    <CheckIcon /> 埋め込みモデル：ダウンロード済み
  </CheckItem>

  <CheckItem status="ok">
    <CheckIcon /> 検索インデックス：構築済み
  </CheckItem>

  <Summary>
    ✅ オフラインで利用可能です
  </Summary>
</OfflineReadinessCheck>
```

---

## 14. Open Questions & Risks

### Open Questions

1. **Q**: How to handle large PDF uploads on mobile devices?
   - **Current Plan**: Allow upload, process in chunks (avoid memory overflow)
   - **Alternative**: Provide pre-processed rule packs for download
   - **Status**: To be decided based on testing

2. **Q**: Should we support offline voice input?
   - **Technical**: Web Speech API works offline on some browsers (e.g., Chrome Android)
   - **Reliability**: Varies by device and language
   - **Recommendation**: Support it, but warn users that accuracy may be lower
   - **Status**: Implement with feature detection

3. **Q**: How to update rule documents in deployed apps?
   - **Option A**: Manual re-upload (user responsibility)
   - **Option B**: Auto-update when online (check for new versions)
   - **Recommendation**: Option B with user confirmation
   - **Status**: Future enhancement (post-MVP)

### Risks

1. **Risk**: IndexedDB quota exceeded on low-storage devices
   - **Likelihood**: Medium (especially iOS Safari with 1GB limit)
   - **Impact**: High (cannot store rules → app unusable offline)
   - **Mitigation**: Implement quota monitoring, allow users to clear old data
   - **Contingency**: Offer "lite mode" with only FIDE rules (no embeddings)

2. **Risk**: Service Worker registration fails
   - **Likelihood**: Low (well-supported in modern browsers)
   - **Impact**: High (no offline capability)
   - **Mitigation**: Graceful fallback, show warning to user
   - **Contingency**: Provide static HTML version of key rules

3. **Risk**: Transformers.js fails to load on older devices
   - **Likelihood**: Medium (requires WebAssembly support)
   - **Impact**: Medium (vector search unavailable, fallback to full-text)
   - **Mitigation**: Feature detection, automatic fallback
   - **Contingency**: Full-text search only (acceptable performance)

4. **Risk**: Background sync not supported (older browsers)
   - **Likelihood**: Medium (Safari lacks full support)
   - **Impact**: Low (manual sync fallback available)
   - **Mitigation**: Detect support, use `window.online` event listener
   - **Contingency**: Manual "同期" button (always visible)

---

## 15. Future Enhancements

1. **Peer-to-Peer Sync** (via WebRTC)
   - Arbiters can sync data directly without server
   - Useful for remote tournaments with local network

2. **Offline-First Analytics**
   - Track incident types, ruling patterns locally
   - Sync analytics to server when online

3. **Delta Sync**
   - Only sync changed fields (not entire entities)
   - Reduces bandwidth usage

4. **Conflict-Free Replicated Data Types (CRDTs)**
   - Automatic conflict resolution without manual intervention
   - More complex to implement, but better UX

---

## 16. References

- [Product Requirements](../requirements/product-requirements.md) - §31 (Offline Requirements)
- [ADR-001: Technology Stack](../decisions/ADR-001-technology-stack.md) - PWA, IndexedDB
- [ADR-002: Decision Tree & LLM Boundary](../decisions/ADR-002-decision-tree-llm-boundary.md) - Offline-capable components
- [AI/RAG Design](./ai-rag-design.md) - Vector search, embeddings
- [Architecture](./architecture.md) - Overall system design

---

## Revision History

- 2026-10-06: Initial version
