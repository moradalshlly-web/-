---
"@nodaro/shared": minor
"@nodaro/sdk": minor
---

A FAILED node in a workflow execution now carries what its run RETAINED.

`NodeExecutionState.output` was an unstated convention of the COMPLETED path:
every consumer read it under `status === "completed"`, so a run that refused its
result and kept what it produced had nowhere to put it. The 3D-scene authoring
lanes are exactly that case — once the repair budget is spent and the visual
reviewer refuses, the run has already published a real, renderable revision, and
the job settles `failed` holding it.

- **`@nodaro/shared`** declares the contract once: `NodeExecutionStateWire` (the
  shape the orchestrator writes and every client reads), the `NodeExecutionStatus`
  union, and `OUTPUT_BEARING_NODE_STATUSES` / `nodeStateMayCarryOutput()` — the
  rule that `completed` AND `failed` may carry `output`, and nothing else can.
- **`@nodaro/sdk`**: `NodeExecutionState` extends that wire type, so `output` is
  a typed, documented field rather than something reachable only through the
  index signature. `NodeExecutionStatus`, `OUTPUT_BEARING_NODE_STATUSES` and
  `nodeStateMayCarryOutput` are re-exported from the package root.

Additive on the wire — a client that does not read `output` on a failed node
sees byte-identical behaviour. Two rules for one that does: gate on the FIELD
rather than the status, and never read a present `output` as success. The node
failed; it failed holding something.
