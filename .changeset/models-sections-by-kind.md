---
"@nodaro/shared": minor
---

`groupByKindAndFamily` — the Image / Video / Audio envelope `GET /v1/models` and MCP `list_models` render, filing every model under its own kind before grouping by vendor family. An unfiltered call used to file every VEO, Seedance, Wan and ByteDance video model under the image section (the family's first model decided the whole vendor). `MODEL_KINDS` is exported alongside it, and the lone `ByteDance` family spelling is now `Bytedance` like the other 15 entries.
