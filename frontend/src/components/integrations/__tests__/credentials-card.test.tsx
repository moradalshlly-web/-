/**
 * Integrations → HTTP credentials: list with lock badges, add (the secret is
 * typed once and posted, never echoed), lock an existing one, delete with a
 * confirmation, and the missing-instance-key banner that follows the latest
 * outcome.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("@/lib/api", () => ({
  listHttpCredentials: () => apiMock.list(),
  createHttpCredential: (input: unknown) => apiMock.create(input),
  updateHttpCredential: (id: string, patch: unknown) => apiMock.update(id, patch),
  deleteHttpCredential: (id: string) => apiMock.remove(id),
  isEncryptionKeyMissingError: (err: unknown) => (err as { code?: string })?.code === "encryption_key_missing",
}))
vi.mock("sonner", () => ({ toast: toastMock }))

import { CredentialsCard } from "../credentials-card"

const LOCKED = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "CRM key",
  authKind: "header",
  headerName: "X-API-Key",
  boundUrl: "https://crm.example.com/hooks/in",
  boundMatch: "exact",
  createdAt: "2026-09-22T00:00:00.000Z",
  updatedAt: "2026-09-22T00:00:00.000Z",
}
const PLAIN = { ...LOCKED, id: "00000000-0000-4000-8000-0000000000c2", name: "Grok bot", headerName: "Authorization", boundUrl: null }

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CredentialsCard />
    </QueryClientProvider>,
  )
}

/** Fill the add form's required fields and submit. */
async function submitNewCredential(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /add credential/i }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: name } })
  fireEvent.change(within(dialog).getByLabelText(/secret value/i), { target: { value: "s" } })
  fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }))
  return dialog
}

beforeEach(() => {
  apiMock.list.mockReset()
  apiMock.create.mockReset()
  apiMock.update.mockReset()
  apiMock.remove.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
  apiMock.list.mockResolvedValue({ data: [LOCKED, PLAIN] })
})

describe("CredentialsCard", () => {
  it("lists credentials with their header name and lock state; the secret is nowhere", async () => {
    const { container } = renderCard()
    expect(await screen.findByText("CRM key")).toBeInTheDocument()
    expect(screen.getByText("Grok bot")).toBeInTheDocument()
    expect(screen.getByText("X-API-Key")).toBeInTheDocument()
    expect(screen.getByText("https://crm.example.com/hooks/in")).toBeInTheDocument()
    expect(screen.getByText("Locked")).toBeInTheDocument()
    expect(screen.getByText("Not locked")).toBeInTheDocument()
    expect(screen.getByText("2 saved")).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/ciphertext|secret value:/i)
  })

  it("a locked row offers to change its address; a plain row offers to lock", async () => {
    renderCard()
    await screen.findByText("CRM key")
    expect(screen.getByRole("button", { name: /change address: crm key/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /lock to an address: grok bot/i })).toBeInTheDocument()
  })

  it("adds a credential: the form posts name, header, secret and an exact lock; then the list refreshes", async () => {
    apiMock.create.mockResolvedValue({ data: { ...PLAIN, id: "new" } })
    renderCard()
    await screen.findByText("CRM key")

    fireEvent.click(screen.getByRole("button", { name: /add credential/i }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: " Zapier " } })
    fireEvent.change(within(dialog).getByLabelText(/header name/i), { target: { value: "X-Zap-Key" } })
    fireEvent.change(within(dialog).getByLabelText(/secret value/i), { target: { value: "zap_123" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: /only for this address/i }))
    fireEvent.change(within(dialog).getByLabelText(/address \(https\)/i), { target: { value: "https://hooks.zapier.com/hooks/catch/1/abc" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(apiMock.create).toHaveBeenCalledWith({
        name: "Zapier",
        headerName: "X-Zap-Key",
        secret: "zap_123",
        boundUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
        boundMatch: "exact",
      }),
    )
    await waitFor(() => expect(apiMock.list).toHaveBeenCalledTimes(2))
    expect(toastMock.success).toHaveBeenCalled()
  })

  it("will not submit an https-less lock address or an empty secret", async () => {
    renderCard()
    await screen.findByText("CRM key")
    fireEvent.click(screen.getByRole("button", { name: /add credential/i }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "x" } })
    fireEvent.change(within(dialog).getByLabelText(/secret value/i), { target: { value: "" } })
    expect(within(dialog).getByRole("button", { name: /^save$/i })).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(/secret value/i), { target: { value: "s" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: /only for this address/i }))
    fireEvent.change(within(dialog).getByLabelText(/address \(https\)/i), { target: { value: "http://plain.example/hook" } })
    expect(within(dialog).getByRole("button", { name: /^save$/i })).toBeDisabled()
    expect(apiMock.create).not.toHaveBeenCalled()
  })

  it("locks an existing plain credential through the lock dialog", async () => {
    apiMock.update.mockResolvedValue({ data: { ...PLAIN, boundUrl: "https://api2.cursor.sh/automations/webhook" } })
    renderCard()
    await screen.findByText("Grok bot")

    fireEvent.click(screen.getByRole("button", { name: /lock to an address: grok bot/i }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/address \(https\)/i), { target: { value: "https://api2.cursor.sh/automations/webhook" } })
    fireEvent.click(within(dialog).getByRole("switch", { name: /every address under it/i }))
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }))

    await waitFor(() =>
      expect(apiMock.update).toHaveBeenCalledWith(PLAIN.id, { boundUrl: "https://api2.cursor.sh/automations/webhook", boundMatch: "prefix" }),
    )
  })

  it("deletes after a confirmation", async () => {
    apiMock.remove.mockResolvedValue({ deleted: true })
    renderCard()
    await screen.findByText("Grok bot")
    fireEvent.click(screen.getByRole("button", { name: /delete: grok bot/i }))
    const confirm = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"))
    fireEvent.click(within(confirm).getByRole("button", { name: /delete/i }))
    await waitFor(() => expect(apiMock.remove).toHaveBeenCalledWith(PLAIN.id))
  })

  it("shows the missing-instance-key banner when the server cannot store a secret, and clears it once a later save succeeds", async () => {
    apiMock.create.mockRejectedValueOnce(Object.assign(new Error("No instance encryption key"), { code: "encryption_key_missing" }))
    renderCard()
    await screen.findByText("CRM key")
    const dialog = await submitNewCredential("x")
    // The form dialog stays open on failure (the user may retry or cancel), so the
    // banner behind it is aria-hidden to the modal — query it as hidden.
    expect(await screen.findByRole("alert", { hidden: true })).toHaveTextContent(/NODARO_ENCRYPTION_KEY/)
    expect(toastMock.error).toHaveBeenCalled()

    // The operator sets the key; the next save goes through and the banner is gone.
    apiMock.create.mockResolvedValueOnce({ data: { ...PLAIN, id: "new" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(apiMock.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole("alert", { hidden: true })).toBeNull())
  })

  it("reopening the form never shows a previously typed secret", async () => {
    renderCard()
    await screen.findByText("CRM key")
    fireEvent.click(screen.getByRole("button", { name: /add credential/i }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/secret value/i), { target: { value: "zap_123" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: /add credential/i }))
    const again = await screen.findByRole("dialog")
    expect(within(again).getByLabelText(/secret value/i)).toHaveValue("")
  })
})
