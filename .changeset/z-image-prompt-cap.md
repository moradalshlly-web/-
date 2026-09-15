---
"@nodaro/shared": patch
---

Correct Z-Image's prompt-length cap to the 1000 characters its KIE schema states (it was listed as the 5000-char default, so a longer prompt was sent and refused upstream).
