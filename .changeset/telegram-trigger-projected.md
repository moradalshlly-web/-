---
"@nodaro/shared": minor
---

`telegram-trigger` is a projected trigger node type.

`TELEGRAM_TRIGGER_NODE_TYPE` joins `SCHEDULE_TRIGGER_NODE_TYPE` and
`WEBHOOK_TRIGGER_NODE_TYPE` in `PROJECTED_TRIGGER_NODE_TYPES`, so
`isProjectedTriggerNodeType("telegram-trigger")` is now `true`. The set is the
one vocabulary both sides read: the server projects these node types onto
`workflow_triggers` rows when a workflow is saved, and the editor asks for that
projection after its own saves. A Telegram Trigger placed in the editor used to
be decorative — its Activate button wrote `isActive` onto node data and nothing
registered the bot with Telegram — and adding the type here is what makes a
saved graph the thing that arms it.

The comment claiming `telegram-trigger` "registers its own row through the
Telegram webhook" is gone; it was never true.

Structural vocabulary only — no creative content, no behaviour change inside
the package beyond the set's third member.
