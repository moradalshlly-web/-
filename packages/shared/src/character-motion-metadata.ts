/** Structural public catalog API metadata. Authored values remain in @nodaro/prompts. */
export interface CharacterMotionMetadata {
  /** Search terms, including previous display names. IDs remain stable. */
  readonly aliases?: readonly string[]
  /** Hidden from new choices; saved workflows still resolve this entry. */
  readonly deprecated?: true
  readonly replacementId?: string
  /** Authored prerequisites; omission is unknown, never a compatibility claim. */
  readonly requires?: readonly string[]
  readonly startPose?: "standing" | "seated" | "floor" | "any"
  readonly endPose?: "standing" | "seated" | "floor" | "any"
  readonly endVisibility?: "in-frame" | "out-of-frame"
  readonly handsAfter?: "free" | "occupied" | "holding-partner"
  readonly needsFreeHands?: true
  readonly kind?: "single" | "compound"
  readonly fixedPace?: true
  /** Non-human/dependent recipient substituted through the Partner handle. */
  readonly counterpart?: string
}
