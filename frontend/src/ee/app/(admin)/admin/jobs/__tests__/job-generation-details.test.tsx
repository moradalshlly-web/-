import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it } from "vitest"
import { JobGenerationDetails } from "../job-generation-details"
afterEach(cleanup)
it("shows recorded model and generation parameters above the JSON", () => {
  render(<JobGenerationDetails input={{provider:"seedance-2-5",resolution:"480p",duration:30,aspectRatio:"9:16",generateAudio:false,seed:0}} />)
  expect(screen.getByText("seedance-2-5")).toBeTruthy()
  expect(screen.getByText("480p")).toBeTruthy()
  expect(screen.getByText("30 sec")).toBeTruthy()
  expect(screen.getByText("9:16")).toBeTruthy()
  expect(screen.getByText("No")).toBeTruthy()
  expect(screen.getByText("0")).toBeTruthy()
})
it("keeps unknown model identifiers visible and does not fabricate defaults", () => {
  render(<JobGenerationDetails input={{model:"custom-model",provider:"kie",duration:"5s",prompt:"not a parameter card",resolution:null}} />)
  expect(screen.getByText("custom-model")).toBeTruthy()
  expect(screen.getByText("5s")).toBeTruthy()
  expect(screen.queryByText("Resolution")).toBeNull()
  expect(screen.queryByText("not a parameter card")).toBeNull()
})
it("handles missing and malformed settings", () => {
  const {rerender,container}=render(<JobGenerationDetails input={null} />)
  expect(container.textContent).toBe("")
  rerender(<JobGenerationDetails input={{duration:NaN,model:{id:"bad"},quality:[]}} />)
  expect(container.textContent).toBe("")
})
