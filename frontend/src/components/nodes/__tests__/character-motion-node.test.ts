import { describe, it, expect } from "vitest"
import { characterMotionCardTitle } from "../character-motion-node"

describe("characterMotionCardTitle", () => {
  it("shows Auto when nothing is picked", () => {
    expect(characterMotionCardTitle([])).toBe("Auto")
  })
  it("shows one label, two labels, or the first label plus the remaining count", () => {
    expect(characterMotionCardTitle(["wave-hello"])).toBe("Wave hello")
    expect(characterMotionCardTitle(["walk-in-from-left", "wave-hello"])).toBe("Walk in from left + Wave hello")
    expect(characterMotionCardTitle(["walk-in-from-left", "turn-to-camera", "wave-hello"])).toBe("Walk in from left + 2")
  })
})
