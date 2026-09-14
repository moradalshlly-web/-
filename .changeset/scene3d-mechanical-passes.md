---
"@nodaro/shared": patch
"@nodaro/sdk": patch
---

Scene3D authoring results declare two more things an advanced engine already
delivers: `mechanicalPasses` and `restoredAssertions`.

**`mechanicalPasses`** — repairs the engine authored ITSELF. When a mandatory
finding that refused a build carries the compiler's own structured remedy, the
engine applies that remedy and rebuilds, with no planner call.

Those passes are counted **apart** from `repairPasses` and never folded into it,
the same way `admissionRetries` is, because they buy their own quoted allowance:
a `mechanical` line on the quote, bounded and released when unspent, rather than
one of the caller's repairs. The pass identity the pricing keeps is
`buildPasses === authoringPasses + repairPasses + mechanicalPasses`.

Two consequences a reader has to know:

- The two counts are independent, so a run may legitimately report **more**
  mechanical passes than repairs. Nothing may assert a relation between them.
- There is one exception, and the **quote** is what discriminates it — not the
  result. A run quoted before that allowance existed has no `mechanical` quote
  line, and there the pass charged a repair, making the count a subset of
  `repairPasses`. The result reports the same field either way, so read the
  quote you were given rather than deriving the accounting from the counts.

**`restoredAssertions`** — mandatory assertions the engine put back after a
planner answer re-shaped one the feedback had not named, restored to the last
admitted recipe's exact form so the run continues instead of being refused over
a value the engine already held. Each entry is `{op, path, value?, assertionId,
reason}` (`value` is `unknown`: a restored assertion holds whatever it holds),
and each is also an `ASSERTION_RESTORED` warning. An assertion the feedback DOES
name is left alone.

Both are declared on `Pro3DRenderJobOutput` (and its reader schema) and on the
`Scene3DAuthoringDelivery` mixin, so they reach every lane that already carried
`repairPasses`. New `SCENE3D_REMEDY_AUTO_APPLIED_CODE` and
`SCENE3D_ASSERTION_RESTORED_CODE` exports give the two warning codes one place to
be read from, as the assumption and review codes already have.

Nothing changes on the wire: the reader schemas are `.passthrough()`, so these
fields were already arriving and were simply invisible to a typed caller. The
`restoredAssertions` sub-schema is deliberately tolerant — it rides a result with
a real MP4, which must never fail to parse over a malformed advisory.
