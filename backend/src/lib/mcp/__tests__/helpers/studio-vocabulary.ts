/**
 * The studio's two vocabularies, as a tripwire.
 *
 * The DOCUMENT calls a scene a "shot" (`shots[]`, `shot_id`, `add_shot`, …). The
 * PERSON calls it a scene: in the editor a film is made of scenes, a scene has
 * a frame (`still`) and a motion (`clip`), and the SHOTS they talk about are
 * the timed `beats[]` inside a motion. The identifiers stay — renaming them
 * would break the wire for a problem that is about language — so the rule is
 * about PROSE: everywhere a sentence is written for a model or a person, the
 * bare word "shot" means a shot inside a motion, never a scene.
 *
 * (Incident 2026-09-20: the person asked the studio copilot about "shot 2" and
 * was answered about scene 2, because every sentence the model had read — the
 * doctrine, the per-turn summary, the tool descriptions — called a scene a shot.)
 *
 * This cannot PROVE a sentence means the right thing; it catches the way the
 * mistake is actually made. A CLAUSE that uses the bare word "shot" has to say
 * what the shot is inside of, in one of the ways a correct sentence does:
 *
 *   - it names the MOTION the shot is inside of ("3 shots inside the motion"),
 *     or the document's `beats` ("set the shots with `set_beats`");
 *   - it places a numbered shot in a scene ("shot 2 of this scene");
 *   - it is the prohibition itself ("never call a scene a shot").
 *
 * Merely mentioning a scene in the same clause is NOT enough — "append a shot
 * after the last scene" is the mistake, not an excuse for it. Clause by clause,
 * because a long sentence that gets it right at the end ("…, set the shots
 * inside a scene's motion") would otherwise excuse the mistake at its start
 * ("rename a shot, …"); two mutation/review rounds found exactly these.
 *
 * What is inside double quotes is somebody's own words — an utterance being
 * quoted ("change shot 2"), or a name the person typed ("Shot 12 — alley") — and
 * is not this prose's vocabulary. Short spans only, so an unbalanced quote
 * cannot swallow a paragraph.
 *
 * Known cost, accepted: a correct clause with no anchor ("each shot has a
 * duration in seconds") is rejected, and the author writes "each shot inside the
 * motion …". That is the tripwire working — an anchorless "shot" is exactly the
 * sentence a model cannot resolve either.
 */

/** Somebody's own words: a quoted utterance, enum literal or typed name. */
const QUOTED = /"[^"\n]{0,60}"/g

/** Identifiers are the document's and are left alone. */
function withoutIdentifiers(clause: string): string {
  return (
    clause
      // code spans: `shots[]`, `shot_id`, `add_shot`
      .replace(/`[^`]*`/g, " ")
      // snake_case names outside code font: new_studio_shot_from_frame, shot_id
      .replace(/\b\w+_\w+\b/g, " ")
      // camelCase names: shotId
      .replace(/\b[a-z]+[A-Z]\w*\b/g, " ")
      // English compounds that are not about the studio at all: one-shot
      .replace(/\b\w+-shots?\b/gi, " ")
  )
}

/** The ways a correct clause says what its shot is inside of (see the header). */
const ANCHORS: readonly RegExp[] = [
  /\bmotions?\b/i,
  // no leading \b: `_` is a word character, so \bbeats would miss `set_beats`
  /beats\b/i,
  /\bshots?(\s+\d+)?\s+(of|in|inside)\s+(this|that|the|a|each|every)\s+scene\b/i,
  /\bcall(s|ed|ing)?\s+a\s+scene\s+a\s+shot\b/i,
]

/**
 * The clauses of `prose` that use the bare word "shot" without saying what it is
 * inside of — i.e. that use it the way the document does, for a scene.
 */
export function scenesCalledShots(prose: string): string[] {
  return prose
    .replace(QUOTED, " ")
    .split(/[.!?;:,]\s+|\s+[—–|]\s+|\n+/)
    .map((clause) => clause.trim())
    .filter((clause) => /\bshots?\b/i.test(withoutIdentifiers(clause)))
    .filter((clause) => !ANCHORS.some((anchor) => anchor.test(clause)))
}
