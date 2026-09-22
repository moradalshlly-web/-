# Schedule Trigger

> Trigger workflow execution on a recurring schedule.

## Overview

The Schedule Trigger node runs workflows automatically on a time-based schedule. Supports preset intervals (every 5 minutes to daily) or custom cron expressions. Optionally limit total executions. The scheduler checks every 60 seconds and skips if the workflow is already running.

The schedule becomes active when the workflow is **saved** with the node on the canvas — from the editor, or through the API / SDK / MCP — and stops when the node is removed and the workflow saved again (a row whose node is gone is also dropped by the scheduler itself). A schedule whose node **you added in the editor** counts as your own run for a stored HTTP credential (see [Webhook Output](../output/webhook-output.md)); one created through the API, or one that was already in the workflow when you opened it, does not.

## What a triggered run executes

A trigger that is **wired to something** runs only the branch behind it — the nodes downstream of the trigger, plus every node those nodes need as input (so a branch that also reads from a node off to the side gets a fresh result). Nodes the trigger does not reach are left alone. A trigger **wired to nothing** runs the whole workflow. This is what lets one workflow carry several triggers, each starting its own branch. A manual run from the editor, an API run and a published app are not scoped by triggers.

"Wired" is anything that feeds another node: a drawn connection, a node inside a Group (it feeds the group), or a field mapping. The run starts from the node the schedule was saved from; a schedule created by hand through the API names no node, so the only Schedule Trigger on the canvas is used — with two such nodes there is no honest answer, and the whole workflow runs.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Interval | Select | every hour | Preset or custom schedule |
| Timezone | Text | UTC | Timezone for schedule evaluation |
| Max Executions | Number | — | Optional limit (empty = unlimited) |

### Interval Options

| Option | Description |
|--------|-------------|
| Every 5 minutes | Runs at :00, :05, :10, etc. |
| Every 15 minutes | Runs at :00, :15, :30, :45 |
| Every hour | Runs at the top of each hour |
| Every day | Runs at midnight |
| Custom cron | 5-field cron expression |

### Custom Cron Format

```
minute hour day-of-month month day-of-week
 * * * * *
```

Examples:
- `0 9 * * 1-5` — 9:00 AM, Monday through Friday
- `*/30 * * * *` — Every 30 minutes
- `0 0 1 * *` — First day of each month at midnight

## Inputs & Outputs

## Activation

**Saving the workflow is what schedules it.** Every save projects the graph's
trigger nodes onto the server's schedule registry: a configured Schedule
Trigger node starts firing, a change to its interval or timezone takes effect,
and deleting the node stops it. Nothing else to press.

This works however the workflow was written — the editor, the API, the SDK,
`import`, or MCP — so a workflow you created programmatically is scheduled the
moment it is saved with a configured node.

Three details worth knowing:

- **A half-configured node is not scheduled.** Pick *Custom cron* but leave the
  expression empty and nothing is registered, deliberately — a schedule never
  starts on a guess. Fill it in and save again.
- **An unknown timezone is not scheduled either.** A timezone the server
  cannot read (a typo, a city name instead of `Area/City`) is refused rather
  than silently replaced with UTC — the run would land at hours you never
  asked for. Fix the name and save again. Presets run on the clock in that
  timezone: every 5 minutes is :00, :05, :10…, hourly is on the hour.
- **Schedules you created by hand** against `POST /v1/workflow-triggers` are
  left alone: they are not managed by any node, so no save will change or
  remove them.

Inspect what a workflow currently has with
`GET /v1/workflows/<id>/triggers`, and pause or resume one with
`PATCH /v1/workflow-triggers/<id>` (`{ "isActive": false }`). A later save
re-activates a paused node-managed schedule, since the graph is the source of
truth — remove the node to stop it for good.

**Inputs:** None (this is a trigger node)

**Outputs:**
- Trigger metadata (timestamp, execution count)
## Best Practices

- Start with longer intervals and decrease as needed
- Set Max Executions during testing to avoid runaway executions
- Account for timezone when scheduling (especially for daily triggers)
- The scheduler skips if the previous execution is still running

## Common Use Cases

- Daily social media content generation and posting
- Recurring report generation from RSS feeds
- Scheduled video rendering during off-peak hours
- Periodic content refresh pipelines

## Tips

- Plan your interval based on how frequently you need the workflow to run
- Combine with Webhook Trigger for workflows that run both on schedule and on demand
- The 60-second check interval means schedules are accurate to within 1 minute
- Workflows already in progress are skipped, preventing duplicate runs
