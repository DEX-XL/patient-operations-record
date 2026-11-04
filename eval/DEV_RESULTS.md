# Development rules-baseline run

Development cases only. No held-out content opened. No model requests. This is not a final agent-vs-baseline evaluation or a clinical result.

Scoring uses the common proposal-action extractor for both methods: staged findings and created tasks, with semantic task/finding duplicates counted once. Additional actual tasks count as predictions. Earlier reports scored internal rule detections alone; this pre-freeze correction lowers pneumonia precision without changing the baseline's behavior.

Config SHA-256: 33fd55b09b7520524fa1f71ecaa5048007adc2fd23e35ef5c5ddaada1492e24c

| Scenario | Recall | Precision | Owner accuracy | Valid proposal |
| --- | --- | --- | --- | --- |
| dev-appendicitis-slot | 100.0% | 100.0% | 100.0% | yes |
| dev-appendicitis-handover | 100.0% | 100.0% | 100.0% | yes |
| dev-pneumonia-signout | 100.0% | 60.0% | 100.0% | yes |
| dev-pneumonia-contradiction | 100.0% | 66.7% | 100.0% | yes |
| dev-heart-failure-echo | 100.0% | 100.0% | 100.0% | yes |
| dev-heart-failure-handover | 100.0% | 66.7% | 100.0% | yes |

All per-case outputs, failures and denominators are in the adjacent JSON files. Must-not prose has not been automatically adjudicated; no zero-violation claim is made.
