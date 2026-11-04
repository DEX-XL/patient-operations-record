# Held-out evaluation set (heldout-v1), FROZEN 2026-10-27

**Do not open these files during development.** That covers prompt writing, rule writing, baseline tuning and UI testing. They are read only by the evaluation step (brief B7), after feature freeze (Nov 1, 9 PM ET).

| File | SHA-256 |
|---|---|
| inputs.json | 99793b06a23bf8e09e90be14cbd61c75462d883486a6a5b057d77821e13868a8 |
| gold.json | 3d0fa3333e7e6c25be27447768ace2b84e7cec774248d69410b9c2a1495c8983 |

- 4 scenarios: H-A1 and H-A2 (appendicitis), H-P1 and H-P2 (pneumonia). Each has a messy shorthand sign-out containing one contradiction, one hidden promise and at least one item with no matching order.
- 24 required gold items, 3 optional, plus global and per-scenario "must not" rules.
- **Provenance (state this in EVAL.md):** written by Claude (Anthropic) on Oct 27 at Rohit's request, and scored against a Meta model, so the author is a different model family from the system tested. Rohit may edit them before Oct 29. Any change after that makes a new version (heldout-v2) with new hashes, and the reason is logged here.
- Copy this folder into the app repo only at B7. Before running, check the hashes with `Get-FileHash` or `sha256sum`.
- 100% synthetic. Any resemblance to real patients is accidental.
