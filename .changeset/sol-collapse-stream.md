---
"@nodaro/shared": patch
---

Serve `gpt-5.6-sol` over KIE's collapsed streaming wire (`kieCollapseStream`). KIE's non-streaming responses endpoint returned `500 server_error` for it on 2026-09-17, retiring the 2026-07-14 reading that the GPT-5.6 family is reliable non-stream; this is the same lane failure and the same remedy `gpt-6-astra` already carries.
