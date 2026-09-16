---
"@nodaro/shared": minor
---

Transition and Character FX now read the nodes wired into them when their text is injected into a prompt, on every path — not just in the editor preview.

Wire a Setting, Tone or Lighting picker into a Transition node's **Start state** / **End state** and the generated prompt now says what the shot starts from and ends at ("…, starting from warm golden morning light, ending at deep blue moonlit night"). Wire a Character, Face, Object or Location into a Character FX node's **Target** and the effect is written about that subject by name ("Aria Voss transforms into a werewolf…") instead of "the subject".

This is the text the node's own injection preview and canvas card already showed. Until now the two executors dropped it, so a run disagreed with the preview; both now compose it, whether the picker feeds a consumer's cinematography handle directly or is placed by `{Label}`.

**Existing workflows that wire those handles will produce different prompts** — that is the point of the change, and the new text is what the preview promised. A Transition or Character FX node with nothing wired into its own handles is byte-identical to before.

`EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES` (exported from `@nodaro/shared`) gains `transition` and `character-fx`.
