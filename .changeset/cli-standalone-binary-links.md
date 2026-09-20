---
"@nodaro/cli": patch
---

README: the standalone-binary install commands reach a binary again. Every `releases/latest/download/…` link answered 404 — the repository's "latest" release is the app's, and the CLI binaries are attached to `cli-vX.Y.Z` releases. The commands now resolve the newest `cli-v*` tag when they run and download from it (with `curl -f`, so an HTTP error is an error and not a page saved as the binary), and Windows gets a PowerShell equivalent.
