# Classifier evaluation (2026-10-09T16:22:48.523Z)

Dataset: `classification-eval-ja` v1, 270 of 270 items (synthetic; sent through protectIncidentText, route classify).

## Summary

| Provider | Model | Accuracy (tuning) | Accuracy (held-out) | Top-2 (held-out) | Latency p50 / p95 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Jev | jev-1.13.0 | 91.1% | 89.6% | 95.6% | 163 ms / 204 ms | ok 270, rejected 0, not-sent 0, error 0 |
| Gemini | (未実行) | | | | | |
| Keyword (local) | - | 62.2% | 70.4% | n/a | - / - | ok 219, rejected 0, not-sent 0, error 51 |

## Acceptance gate (jev-classifier-design §9.3)

| Check | Result | Detail |
| --- | --- | --- |
| accuracy-vs-gemini | FAIL | Gemini の結果がない（比較できない） |
| per-category | FAIL | tournament-admin 66.7% |
| t-medium | FAIL | T=0.4 (tuning 91.1%, n=135; held-out 89.6%, n=134) |
| t-prefill | PASS | T=0.4 (tuning 91.1%, n=135; held-out 89.6%, n=134) |
| latency-p95 | PASS | p50 163 ms / p95 204 ms |
| no-failures | PASS | ok 270, rejected 0, not-sent 0, error 0 |

**Accepted:** no. **Calibration candidate:** not written.

## Held-out accuracy per category

| Category | n | Jev | Gemini | Keyword |
| --- | --- | --- | --- | --- |
| illegal-move | 15 | 93.3% | n/a | 46.7% |
| board-piece | 15 | 93.3% | n/a | 73.3% |
| clock-time | 15 | 100% | n/a | 100% |
| game-result | 15 | 86.7% | n/a | 40% |
| draw | 15 | 80% | n/a | 66.7% |
| scoresheet | 15 | 93.3% | n/a | 100% |
| player-behavior | 15 | 93.3% | n/a | 53.3% |
| team | 15 | 100% | n/a | 100% |
| tournament-admin | 15 | 66.7% | n/a | 53.3% |

## Thresholds

- T_medium (target 90%): {"tuning":{"threshold":0.4,"support":135,"accuracy":0.9111111111111111},"heldout":{"threshold":0.4,"support":134,"accuracy":0.8955223880597015},"confirmed":false}
- T_prefill (target 80%): {"tuning":{"threshold":0.4,"support":135,"accuracy":0.9111111111111111},"heldout":{"threshold":0.4,"support":134,"accuracy":0.8955223880597015},"confirmed":true}
- T_subtype (target 90%): {"tuning":{"threshold":0.54,"support":28,"accuracy":0.9285714285714286},"heldout":{"threshold":0.54,"support":25,"accuracy":0.96},"confirmed":true}

## Reliability (Jev, held-out, chosen category)

| p range | n | mean p | accuracy |
| --- | --- | --- | --- |
| 0–0.5 | 2 | 0.405 | 50% |
| 0.5–0.7 | 16 | 0.611 | 62.5% |
| 0.7–0.8 | 11 | 0.741 | 63.6% |
| 0.8–0.9 | 9 | 0.836 | 66.7% |
| 0.9–0.95 | 10 | 0.920 | 100% |
| 0.95–0.99 | 24 | 0.967 | 100% |
| 0.99–1 | 63 | 0.998 | 100% |

## Probability sum (Jev raw, §14.3)

n=270, drift min -0.01, max 0, max |drift| 0.01 (tolerance ±0.02).
