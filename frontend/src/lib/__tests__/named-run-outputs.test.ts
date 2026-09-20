// One mapping for a finished node's named side outputs, shared by the live run
// and both load-time restore lanes. The keys are pinned against what READS them:
// the bug (#1547) was two lanes writing names no reader ever looked at.
import { describe, it, expect } from "vitest"
import type { WorkflowNode } from "@/types/nodes"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { namedRunOutputFields } from "../named-run-outputs"

function node(type: string, data: Record<string, unknown>): WorkflowNode {
  return { id: "n1", type, position: { x: 0, y: 0 }, data: { label: "n", ...data } } as unknown as WorkflowNode
}

describe("namedRunOutputFields", () => {
  it("names every side output the way its readers do", () => {
    expect(
      namedRunOutputFields({
        generatedVoiceId: "voice-1",
        vocalUrl: "https://cdn.test/vocals.mp3",
        instrumentalUrl: "https://cdn.test/inst.mp3",
        alignment: [{ word: "hi", start: 0, end: 1 }],
        combinedText: "a b",
        splitResults: ["a", "b"],
      }),
    ).toEqual({
      generatedVoiceId: "voice-1",
      vocalUrl: "https://cdn.test/vocals.mp3",
      instrumentalUrl: "https://cdn.test/inst.mp3",
      alignmentResults: [{ word: "hi", start: 0, end: 1 }],
      combinedText: "a b",
      generatedText: "a b",
      splitResults: ["a", "b"],
    })
  })

  it("writes nothing for an output the node did not produce — a patch must not blank a field it does not own", () => {
    expect(namedRunOutputFields({})).toEqual({})
    expect(namedRunOutputFields({ vocalUrl: "" })).toEqual({})
  })

  it("the stems land where the OUTPUT HANDLES read them — not on the full mix", () => {
    // A missing `vocalUrl` does not read as "no vocals": the handle falls back to
    // `generatedAudioUrl`, so a misnamed restore sent the WHOLE MIX downstream.
    const restored = { generatedAudioUrl: "https://cdn.test/mix.mp3", ...namedRunOutputFields({ vocalUrl: "https://cdn.test/vocals.mp3", instrumentalUrl: "https://cdn.test/inst.mp3" }) }
    for (const type of ["suno-separate", "audio-separation"]) {
      expect(extractNodeOutput(node(type, restored), "vocals"), type).toBe("https://cdn.test/vocals.mp3")
      expect(extractNodeOutput(node(type, restored), "instrumental"), type).toBe("https://cdn.test/inst.mp3")
    }
  })
})
