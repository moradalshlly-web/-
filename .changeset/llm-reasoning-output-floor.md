---
"@nodaro/shared": minor
---

LLM registry: add `reasoningOutputFloor` — the per-model output cap a reasoning call is floored to — with `REASONING_OUTPUT_FLOOR` (the default) and `reasoningOutputFloor(model)`. The Gemini 3 models now declare `thinkingDefaultOn`, floored at the cap every lane serving them accepts: 8192 for Gemini 3 Flash / 3.6 Flash / 3.7 Flash, 16384 for Gemini 3.8 Flash and Gemini 3.1 Pro.
