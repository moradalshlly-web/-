---
"@nodaro/cli": minor
---

Add the `edit` command group over the phase-1 editorial primitives:

- `nodaro edit silence-detect <audioUrl>` — detect silence ranges (`--threshold-db`,
  `--min-silence-ms`, `--pad-ms`).
- `nodaro edit apply-edl --edl <file>` — render an EDL into a video/audio cut
  (`--transcript`, repeatable `--source` overrides, `--output`, `--quality`,
  `--crossfade-ms`).
- `nodaro edit plan --mode <m> --plan-tier <t> --transcript <file>` — plan a
  transcript-driven cut / clips / chapters (repeatable `--source url[@kind]` or a
  full `--sources-file`, plus `--silence`, `--instructions`, `--style-guide`,
  `--count`, `--target-duration-sec`, `--target-aspect`, `--platform`).

Each is a thin wrapper over the SDK `client.edit.*` methods and honors the
CLI's multi-profile auth, `--json` and `--watch` conventions.
