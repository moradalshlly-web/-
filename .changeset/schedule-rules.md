---
"@nodaro/shared": minor
---

New `schedule-rules` module: the Schedule Trigger's rule model (`ScheduleRule` — every N minutes / hours / days / weeks / months, or a cron expression — with `ScheduleSpec` carrying the rules, an IANA timezone and a max-execution count), plus the functions both the editor and a Nodaro server evaluate it with: `normalizeScheduleRules`, `legacyScheduleToRules`, `scheduleMatchesAt`, `scheduleOccurrences` / `nextScheduleRuns` (preview), `isValidTimezone`, `localTimeIn`. Additive: `workflow_triggers.config.rules` is the trigger config wire contract, and the editor's preview must agree with the server's clock.
