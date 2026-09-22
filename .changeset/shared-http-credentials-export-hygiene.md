---
"@nodaro/shared": patch
---

`EXECUTION_DATA_KEYS` now lists the Webhook Output delivery receipt (`webhookSuccess`, `webhookStatusCode`, `webhookResponseBody`), so a reflected response body is stripped from template exports, skipped by undo, and never captured into a node preset. New `stripUnownedRefs(nodes)`: clears the references an importer cannot own — a Webhook Output's `credentialId` and a social publisher's `connectionId` — and is applied by `stripExportContent` and by asset-bundle exports alike.
