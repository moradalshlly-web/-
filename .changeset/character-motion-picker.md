---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

New **Character Motion** parameter picker (`character-motion`): what the subject does across a clip — entrances, turns, head and hand gestures, walks, runway, dance, expressions, camera interaction, stylized combat, athletics, falls, posture shifts, everyday actions, vehicles and animals, two-person moves, idle life, stage performance and uncanny movement. Up to three picks compose an ordered sequence joined with "then"; a wired `target` names the subject and a wired `partner` names the second person ("another person" when unwired); `position` and `pace` add timing. `@nodaro/prompts` exports the catalog, its timing scales and `composeCharacterMotionHintFromConnections`; `@nodaro/shared` adds the node type, its app-input field, its i18n catalog id, `VIDEO_ONLY_PARAMETER_NODE_TYPES` and `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`.
