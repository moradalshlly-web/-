import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  MASK_NO_REGION_MESSAGE,
  ReplicateSanitizedError,
  replicateFailureMessage,
} from "../failure-messages.js"
import { isContentRejection, isRetryableFailure } from "@/lib/mcp/tools/_job-error.js"

// The EXACT text two production generate-mask jobs carried (2026-09-08,
// app-reports lane G): Grounding DINO returned an empty box tensor and SAM
// reshaped it. Pinned verbatim so a future edit to the matcher is measured
// against the string that actually reached users.
const PROD_EMPTY_TENSOR =
  "cannot reshape tensor of 0 elements into shape [0, -1, 256, 256] because " +
  "the unspecified dimension size -1 can be any value and is ambiguous"

describe("replicateFailureMessage", () => {
  it("maps the Grounded SAM zero-detection crash to the no-region sentence", () => {
    expect(replicateFailureMessage("generate-mask", PROD_EMPTY_TENSOR)).toBe(
      MASK_NO_REGION_MESSAGE,
    )
    // The SDK's own wrapper prefix ("Prediction failed: …") on the worker lane.
    expect(
      replicateFailureMessage("generate-mask", `Prediction failed: ${PROD_EMPTY_TENSOR}`),
    ).toBe(MASK_NO_REGION_MESSAGE)
    // A different mask resolution is the same failure.
    expect(
      replicateFailureMessage(
        "generate-mask",
        "cannot reshape tensor of 0 elements into shape [0, -1, 512, 512]",
      ),
    ).toBe(MASK_NO_REGION_MESSAGE)
  })

  it("is scoped by job type — a reshape error from another model is NOT a mask verdict", () => {
    expect(replicateFailureMessage("generate-image", PROD_EMPTY_TENSOR)).toBeNull()
    expect(replicateFailureMessage("lip-sync", PROD_EMPTY_TENSOR)).toBeNull()
    expect(replicateFailureMessage(null, PROD_EMPTY_TENSOR)).toBeNull()
  })

  it("returns null for anything it does not recognise (caller keeps its default)", () => {
    expect(replicateFailureMessage("generate-mask", "CUDA out of memory")).toBeNull()
    expect(replicateFailureMessage("generate-mask", null)).toBeNull()
    expect(replicateFailureMessage("generate-mask", "")).toBeNull()
    // A NON-empty tensor reshape is a real bug, not a no-match.
    expect(
      replicateFailureMessage(
        "generate-mask",
        "cannot reshape tensor of 12 elements into shape [3, -1]",
      ),
    ).toBeNull()
  })

  it("the sentence never names the Threshold slider (a no-op on the pinned model)", () => {
    expect(MASK_NO_REGION_MESSAGE.toLowerCase()).not.toContain("threshold")
  })
})

describe("how the sentence classifies downstream", () => {
  it("is non-retryable — the same request fails the same way", () => {
    expect(isRetryableFailure(MASK_NO_REGION_MESSAGE)).toBe(false)
  })

  it("is NOT a content rejection — nothing was blocked", () => {
    expect(isContentRejection(MASK_NO_REGION_MESSAGE)).toBe(false)
  })
})

describe("ReplicateSanitizedError", () => {
  it("carries the raw provider text on `internalDetails` so error_detail survives", () => {
    const err = new ReplicateSanitizedError(MASK_NO_REGION_MESSAGE, PROD_EMPTY_TENSOR)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(MASK_NO_REGION_MESSAGE)
    expect(err.internalDetails).toBe(PROD_EMPTY_TENSOR)
  })
})

// ── Worker lane: runGroundedSam translates instead of rethrowing PyTorch ─────

const { mockCreate, mockWait, mockFire } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockWait: vi.fn(),
  mockFire: vi.fn(async () => {}),
}))

vi.mock("replicate", () => ({
  default: class {
    predictions = { create: mockCreate }
    wait = mockWait
  },
}))
vi.mock("@/lib/config.js", () => ({ config: { REPLICATE_API_TOKEN: "test-token" } }))
vi.mock("@/lib/reconcile/fire-on-task-created.js", () => ({ fireOnTaskCreated: mockFire }))

const { runGroundedSam } = await import("../grounded-sam.js")

describe("runGroundedSam failure translation", () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockWait.mockReset()
    mockFire.mockReset()
    mockFire.mockResolvedValue(undefined)
    mockCreate.mockResolvedValue({ id: "pred-mask-1" })
  })

  it("turns the zero-detection crash into the no-region sentence + raw detail", async () => {
    mockWait.mockRejectedValue(new Error(`Prediction failed: ${PROD_EMPTY_TENSOR}`))
    await expect(runGroundedSam("https://cdn.example/in.png", "a very long clause", 0.3, "t")).rejects.toThrow(
      MASK_NO_REGION_MESSAGE,
    )
    await expect(
      runGroundedSam("https://cdn.example/in.png", "a very long clause", 0.3, "t"),
    ).rejects.toMatchObject({ internalDetails: expect.stringContaining("0 elements") })
  })

  it("rethrows an unrecognised provider failure untouched", async () => {
    mockWait.mockRejectedValue(new Error("Prediction failed: CUDA out of memory"))
    await expect(
      runGroundedSam("https://cdn.example/in.png", "hat", 0.3, "t"),
    ).rejects.toThrow("CUDA out of memory")
  })

  it("leaves the success path alone", async () => {
    mockWait.mockResolvedValue({
      output: [
        "https://replicate.delivery/x/annotated_picture_mask.jpg",
        "https://replicate.delivery/x/neg_annotated_picture_mask.jpg",
        "https://replicate.delivery/x/mask.jpg",
        "https://replicate.delivery/x/inverted_mask.jpg",
      ],
    })
    await expect(runGroundedSam("https://cdn.example/in.png", "hat", 0.3, "t")).resolves.toBe(
      "https://replicate.delivery/x/mask.jpg",
    )
  })
})
