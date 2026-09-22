---
"@nodaro/shared": patch
---

`stripExportContent` drops a Schedule Trigger's `active` switch from a template export: an imported schedule always starts paused, whatever the exporter's was doing. The rules, timezone and max-execution count still travel.
