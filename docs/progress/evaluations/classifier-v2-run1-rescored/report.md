# Classifier evaluation (2026-10-09T22:17:08.803Z)

Dataset: `classification-eval-ja` v2, 405 of 405 items (synthetic; sent through protectIncidentText, route classify).

## Summary

| Provider | Model | Accuracy (tuning) | Accuracy (held-out) | Top-2 (held-out) | Latency p50 / p95 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Jev | jev-1.13.0 | 94.1% | 90.4% | 99.3% | 169 ms / 259 ms | ok 405, rejected 0, not-sent 0, error 0 |
| Gemini | (未実行) | | | | | |
| Keyword (local) | - | 66.3% | 54.8% | n/a | - / - | ok 313, rejected 0, not-sent 0, error 92 |

## Acceptance gate (jev-classifier-design §9.3)

| Check | Result | Detail |
| --- | --- | --- |
| accuracy-vs-gemini | FAIL | Gemini の結果がない（比較できない） |
| per-category | FAIL | player-behavior 60% |
| t-medium | PASS | T=0.9 (tuning 100%, n=203; held-out 98.9%, n=94) |
| t-prefill | PASS | T=0.8 (tuning 98.7%, n=228; held-out 97.3%, n=113) |
| latency-p95 | PASS | p50 169 ms / p95 259 ms |
| no-failures | PASS | ok 405, rejected 0, not-sent 0, error 0 |

**Accepted:** no. **Calibration candidate:** written (calibration.candidate.json).

## Held-out accuracy per category

| Category | n | Jev | Gemini | Keyword |
| --- | --- | --- | --- | --- |
| illegal-move | 15 | 86.7% | n/a | 13.3% |
| board-piece | 15 | 100% | n/a | 26.7% |
| clock-time | 15 | 100% | n/a | 73.3% |
| game-result | 15 | 93.3% | n/a | 46.7% |
| draw | 15 | 93.3% | n/a | 66.7% |
| scoresheet | 15 | 93.3% | n/a | 86.7% |
| player-behavior | 15 | 60% | n/a | 26.7% |
| team | 15 | 86.7% | n/a | 100% |
| tournament-admin | 15 | 100% | n/a | 53.3% |

## Thresholds

- T_medium (target 90%): {"tuning":{"threshold":0.9,"support":203,"accuracy":1,"wilsonLower":0.9814},"heldout":{"threshold":0.9,"support":94,"accuracy":0.9893617021276596,"wilsonLower":0.9422},"confirmed":true}
- T_prefill (target 80%): {"tuning":{"threshold":0.8,"support":228,"accuracy":0.9868421052631579,"wilsonLower":0.962},"heldout":{"threshold":0.8,"support":113,"accuracy":0.9734513274336283,"wilsonLower":0.9248},"confirmed":true}
- T_subtype (target 90%): {"tuning":{"threshold":0.9,"support":40,"accuracy":1,"wilsonLower":0.9124},"heldout":{"threshold":0.9,"support":24,"accuracy":1,"wilsonLower":0.862},"confirmed":true}

## Reliability (Jev, held-out, chosen category)

| p range | n | mean p | accuracy |
| --- | --- | --- | --- |
| 0–0.5 | 3 | 0.397 | 0% |
| 0.5–0.7 | 11 | 0.622 | 45.5% |
| 0.7–0.8 | 8 | 0.752 | 87.5% |
| 0.8–0.9 | 19 | 0.844 | 89.5% |
| 0.9–0.95 | 7 | 0.926 | 85.7% |
| 0.95–0.99 | 19 | 0.973 | 100% |
| 0.99–1 | 68 | 0.997 | 100% |

## Probability sum (Jev raw, §14.3)

n=405, drift min -0.01, max 0, max |drift| 0.01 (tolerance ±0.02).
