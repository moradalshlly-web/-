/**
 * Webhook Output's credential picker: a credential locked to an EXACT address
 * locks the URL field, and a stored URL that is a DIFFERENT address than the
 * lock (origin + path — a query string is not a difference) is a warning with
 * a one-click fix, never a write on mount; a prefix lock leaves the URL
 * editable with the prefix named; a plain credential is flagged as
 * owner-runs-only; a dangling id is called out — a failed list read is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const hookMock = vi.hoisted(() => ({
  state: { credentials: [] as unknown[], loading: false, error: null as string | null, refresh: vi.fn() },
}))
vi.mock("@/hooks/use-http-credentials", () => ({ useHttpCredentials: () => hookMock.state }))

import { WebhookOutputConfig } from "../webhook-output-config"
import type { WebhookOutputData } from "@/types/nodes"

const EXACT = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "CRM key",
  authKind: "header",
  headerName: "X-API-Key",
  boundUrl: "https://crm.example.com/hooks/in",
  boundMatch: "exact",
  createdAt: "",
  updatedAt: "",
}
const PREFIX = { ...EXACT, id: "00000000-0000-4000-8000-0000000000c2", name: "Bot", boundUrl: "https://api2.cursor.sh/automations/webhook", boundMatch: "prefix" }
const PLAIN = { ...EXACT, id: "00000000-0000-4000-8000-0000000000c3", name: "Plain", boundUrl: null, boundMatch: "exact" }
const DANGLING_ID = "00000000-0000-4000-8000-00000000dead"

function renderPanel(data: Partial<WebhookOutputData>, onUpdate = vi.fn(), nodes: Array<{ id: string; type: string }> = []) {
  const full = { label: "Webhook Output", url: "", params: [], ...data } as WebhookOutputData
  render(
    <MemoryRouter>
      <WebhookOutputConfig
        data={full}
        onUpdate={onUpdate}
        sources={[]}
        fieldMappings={{}}
        onMapField={vi.fn()}
        nodes={nodes as unknown as Parameters<typeof WebhookOutputConfig>[0]["nodes"]}
      />
    </MemoryRouter>,
  )
  return onUpdate
}

beforeEach(() => {
  hookMock.state = { credentials: [EXACT, PREFIX, PLAIN], loading: false, error: null, refresh: vi.fn() }
})

describe("WebhookOutputConfig — credential picker", () => {
  it("an exact-locked credential locks the URL field; a stored URL at another address is a warning with a one-click fix, not a write on mount", () => {
    const onUpdate = renderPanel({ credentialId: EXACT.id, url: "https://somewhere.else/" })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/webhook url/i)).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent(/not the address the credential is locked to/i)
    expect(screen.getByRole("alert")).toHaveTextContent(EXACT.boundUrl)

    fireEvent.click(screen.getByRole("button", { name: /use the locked address/i }))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ url: EXACT.boundUrl })
  })

  it("a URL that already matches the lock: field disabled, no warning, nothing written", () => {
    const onUpdate = renderPanel({ credentialId: EXACT.id, url: EXACT.boundUrl })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/webhook url/i)).toBeDisabled()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByText(/locked to this address/i)).toBeInTheDocument()
  })

  it("a URL that differs from the lock only by its query (or host case) is the SAME address — no warning, the token stays", () => {
    const onUpdate = renderPanel({ credentialId: EXACT.id, url: "https://CRM.example.com/hooks/in?token=abc" })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("button", { name: /use the locked address/i })).toBeNull()
    expect(screen.getByLabelText(/webhook url/i)).toBeDisabled()
  })

  it("a prefix-locked credential keeps the URL editable and names the prefix", () => {
    const onUpdate = renderPanel({ credentialId: PREFIX.id, url: "" })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
    expect(screen.getByText(/works for addresses under https:\/\/api2\.cursor\.sh\/automations\/webhook/i)).toBeInTheDocument()
  })

  it("a plain credential is flagged as owner-runs-only", () => {
    renderPanel({ credentialId: PLAIN.id, url: "https://mine.example/hook" })
    expect(screen.getByText(/not locked to an address/i)).toBeInTheDocument()
    expect(screen.queryByText(/runs on its own/i)).toBeNull()
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
  })

  it("a plain credential on a workflow with a schedule or webhook trigger says those runs will fail", () => {
    renderPanel({ credentialId: PLAIN.id, url: "https://mine.example/hook" }, vi.fn(), [{ id: "s1", type: "schedule-trigger" }])
    expect(screen.getByText(/runs on its own/i)).toBeInTheDocument()
  })

  it("a dangling credential id is called out, never shown raw, and does not lock the URL", () => {
    const onUpdate = renderPanel({ credentialId: DANGLING_ID, url: "https://mine.example/hook" })
    expect(screen.getByText(/saved credential not found/i)).toBeInTheDocument()
    expect(screen.queryByText(DANGLING_ID)).toBeNull()
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("while the list is still loading a stored id is not yet 'missing', and the URL waits for the verdict", () => {
    hookMock.state = { credentials: [], loading: true, error: null, refresh: vi.fn() }
    renderPanel({ credentialId: EXACT.id, url: "" })
    expect(screen.queryByText(/saved credential not found/i)).toBeNull()
    expect(screen.getByLabelText(/webhook url/i)).toBeDisabled()
  })

  it("while loading with NO stored credential the URL is editable", () => {
    hookMock.state = { credentials: [], loading: true, error: null, refresh: vi.fn() }
    renderPanel({ url: "" })
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
  })

  it("a failed list read is said as such — it does not call the stored credential missing", () => {
    hookMock.state = { credentials: [], loading: false, error: "boom", refresh: vi.fn() }
    const onUpdate = renderPanel({ credentialId: EXACT.id, url: "https://mine.example/hook" })
    expect(screen.queryByText(/saved credential not found/i)).toBeNull()
    expect(screen.getByText(/couldn't load your credentials/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("no credential: the plain URL hint and a link to Integrations", () => {
    renderPanel({ url: "" })
    expect(screen.getByText(/the url to post the collected data to/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /manage credentials/i })).toHaveAttribute("href", "/integrations")
    expect(screen.getByLabelText(/webhook url/i)).not.toBeDisabled()
  })
})
