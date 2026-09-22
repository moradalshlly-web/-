/**
 * The publish / share gate's dialog: one click locks a plain credential to
 * the node's own URL; a missing, mismatched or several-addresses credential
 * is explained, not "fixed"; "one address" is what the server's lock means
 * (origin + path, never the query); once every group is locked the caller is
 * told to retry; and a later 409 starts from nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const apiMock = vi.hoisted(() => ({ lockHttpCredential: vi.fn() }))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/api", () => ({ lockHttpCredential: (...args: unknown[]) => apiMock.lockHttpCredential(...args) }))
vi.mock("sonner", () => ({ toast: toastMock }))

import { CredentialLockDialog, groupUnboundUses } from "../credential-lock-dialog"
import type { UnboundCredentialUse } from "@/lib/api"

const PLAIN: UnboundCredentialUse = {
  nodeId: "hook-1",
  nodeLabel: "Deliver to CRM",
  credentialId: "00000000-0000-4000-8000-0000000000c1",
  nodeUrl: "https://crm.example.com/hooks/in",
  kind: "plain",
  credentialName: "CRM key",
}
const MISSING: UnboundCredentialUse = {
  nodeId: "hook-2",
  nodeLabel: "Old webhook",
  credentialId: "00000000-0000-4000-8000-0000000000c2",
  nodeUrl: "https://old.example.com/x",
  kind: "missing",
  credentialName: null,
}
const MISMATCH: UnboundCredentialUse = {
  nodeId: "hook-3",
  nodeLabel: "Ops relay",
  credentialId: "00000000-0000-4000-8000-0000000000c3",
  nodeUrl: "https://ops.example.com/relay",
  kind: "mismatch",
  credentialName: "Ops key",
}
/** The same plain credential on a second node — same address, same address with a query, or elsewhere. */
const PLAIN_TWIN_SAME: UnboundCredentialUse = { ...PLAIN, nodeId: "hook-9", nodeLabel: "Deliver to Ops" }
const PLAIN_TWIN_QUERY: UnboundCredentialUse = { ...PLAIN_TWIN_SAME, nodeUrl: "https://CRM.example.com/hooks/in?run=7" }
const PLAIN_TWIN_ELSEWHERE: UnboundCredentialUse = { ...PLAIN_TWIN_SAME, nodeUrl: "https://ops.example.com/in" }
const PLAIN_TWIN_NO_URL: UnboundCredentialUse = { ...PLAIN_TWIN_SAME, nodeUrl: "" }
const PLAIN_MAPPED: UnboundCredentialUse = { ...PLAIN, nodeId: "hook-m", nodeLabel: "Relay (mapped)", nodeUrl: "", urlMapped: true }

const lockButtons = () => screen.queryAllByRole("button", { name: /lock to this address/i })

beforeEach(() => {
  apiMock.lockHttpCredential.mockReset()
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe("groupUnboundUses", () => {
  it("folds the gate's per-node rows into one decision per credential", () => {
    const groups = groupUnboundUses([PLAIN, PLAIN_TWIN_SAME, MISSING, MISMATCH, { ...PLAIN, nodeUrl: "", credentialId: "c9", nodeId: "n9" }])
    expect(groups.map((g) => [g.credentialId, g.kind, g.url])).toEqual([
      [PLAIN.credentialId, "lockable", PLAIN.nodeUrl],
      [MISSING.credentialId, "missing", ""],
      [MISMATCH.credentialId, "mismatch", ""],
      ["c9", "noUrl", ""],
    ])
    expect(groupUnboundUses([PLAIN, PLAIN_TWIN_ELSEWHERE])[0].kind).toBe("multiUrl")
  })

  it("counts addresses the way the lock does: a query string or host case is not another address", () => {
    const [group] = groupUnboundUses([PLAIN, PLAIN_TWIN_QUERY])
    expect(group.kind).toBe("lockable")
    expect(group.url).toBe(PLAIN.nodeUrl)
  })

  it("a URL-less node rides along with a lockable group but is named separately", () => {
    const [group] = groupUnboundUses([PLAIN, PLAIN_TWIN_NO_URL])
    expect(group.kind).toBe("lockable")
    expect(group.rowsWithoutUrl.map((r) => r.nodeId)).toEqual(["hook-9"])
  })
})

describe("CredentialLockDialog", () => {
  it("locks a plain credential to the node's URL with one click and then tells the caller to retry", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN]} onLocked={onLocked} onClose={() => {}} />)

    expect(screen.getByText("Deliver to CRM")).toBeInTheDocument()
    expect(screen.getByText("https://crm.example.com/hooks/in")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /lock to this address/i }))

    await waitFor(() => expect(apiMock.lockHttpCredential).toHaveBeenCalledWith(PLAIN.credentialId, PLAIN.nodeUrl))
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1))
    expect(toastMock.success).toHaveBeenCalled()
  })

  it("one plain credential on two nodes at the SAME address is one lock: one button, one PATCH, then retry", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN, PLAIN_TWIN_SAME]} onLocked={onLocked} onClose={() => {}} />)

    expect(screen.getByText("Deliver to CRM, Deliver to Ops")).toBeInTheDocument()
    expect(lockButtons()).toHaveLength(1)
    fireEvent.click(lockButtons()[0])
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1))
    expect(apiMock.lockHttpCredential).toHaveBeenCalledTimes(1)
  })

  it("the same address with a query string is still one lock, and the lock is asked for the first node's URL", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN, PLAIN_TWIN_QUERY]} onLocked={onLocked} onClose={() => {}} />)

    expect(lockButtons()).toHaveLength(1)
    expect(screen.queryByText(/different addresses/i)).toBeNull()
    fireEvent.click(lockButtons()[0])
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1))
    expect(apiMock.lockHttpCredential).toHaveBeenCalledWith(PLAIN.credentialId, PLAIN.nodeUrl)
  })

  it("one plain credential on two nodes at DIFFERENT addresses is never locked to either of them", async () => {
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN, PLAIN_TWIN_ELSEWHERE]} onLocked={onLocked} onClose={() => {}} />)

    expect(lockButtons()).toHaveLength(0)
    expect(screen.getByText(/used by 2 nodes at different addresses/i)).toBeInTheDocument()
    expect(screen.getByText("Deliver to CRM, Deliver to Ops")).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(apiMock.lockHttpCredential).not.toHaveBeenCalled()
    expect(onLocked).not.toHaveBeenCalled()
  })

  it("a URL-less node on a lockable credential is named as not covered by the lock", () => {
    render(<CredentialLockDialog uses={[PLAIN, PLAIN_TWIN_NO_URL]} onLocked={() => {}} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(1)
    expect(screen.getByText("Deliver to CRM")).toBeInTheDocument()
    expect(screen.getByText(/Deliver to Ops: This node has no URL yet/i)).toBeInTheDocument()
  })

  it("tells every open credential list about the lock (React Query invalidation) when a provider is present", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const qc = new QueryClient()
    const invalidate = vi.spyOn(qc, "invalidateQueries")
    render(
      <QueryClientProvider client={qc}>
        <CredentialLockDialog uses={[PLAIN]} onLocked={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    )
    fireEvent.click(lockButtons()[0])
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["http-credentials"] }))
  })

  it("explains a missing credential instead of offering a lock, and does not retry while it remains", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN, MISSING]} onLocked={onLocked} onClose={() => {}} />)

    expect(screen.getByText(/no longer exists or isn't yours/i)).toBeInTheDocument()
    expect(lockButtons()).toHaveLength(1)

    fireEvent.click(lockButtons()[0])
    await waitFor(() => expect(apiMock.lockHttpCredential).toHaveBeenCalledTimes(1))
    // The missing use still blocks: no retry.
    await new Promise((r) => setTimeout(r, 20))
    expect(onLocked).not.toHaveBeenCalled()
  })

  it("a deleted credential is named as such, never by its id", () => {
    render(<CredentialLockDialog uses={[MISSING]} onLocked={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Deleted credential")).toBeInTheDocument()
    expect(screen.queryByText(MISSING.credentialId)).toBeNull()
  })

  it("a credential locked to a different address is explained, not moved", async () => {
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[MISMATCH]} onLocked={onLocked} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(0)
    expect(screen.getByText(/locked to a different address than this node sends to/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(apiMock.lockHttpCredential).not.toHaveBeenCalled()
    expect(onLocked).not.toHaveBeenCalled()
  })

  it("a node whose URL comes from another node at run time is explained as such — not as 'no URL yet'", () => {
    render(<CredentialLockDialog uses={[PLAIN_MAPPED]} onLocked={() => {}} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(0)
    expect(screen.getByText(/comes from another node at run time/i)).toBeInTheDocument()
    expect(screen.queryByText(/has no URL yet/i)).toBeNull()
  })

  it("a no-URL group with one mapped and one empty node explains each for itself", () => {
    render(<CredentialLockDialog uses={[PLAIN_MAPPED, { ...PLAIN, nodeId: "hook-e", nodeLabel: "Empty", nodeUrl: "" }]} onLocked={() => {}} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(0)
    expect(screen.getByText(/Relay \(mapped\): This node's address comes from another node/i)).toBeInTheDocument()
    expect(screen.getByText(/Empty: This node has no URL yet/i)).toBeInTheDocument()
  })

  it("a mapped-URL node riding on a lockable credential carries the mapped explanation", () => {
    render(<CredentialLockDialog uses={[PLAIN, PLAIN_MAPPED]} onLocked={() => {}} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(1)
    expect(screen.getByText(/Relay \(mapped\): This node's address comes from another node/i)).toBeInTheDocument()
  })

  it("a node without a URL cannot be locked from here", () => {
    render(<CredentialLockDialog uses={[{ ...PLAIN, nodeUrl: "" }]} onLocked={() => {}} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(0)
    expect(screen.getByText(/has no URL yet/i)).toBeInTheDocument()
  })

  it("surfaces a lock failure and keeps the dialog open", async () => {
    apiMock.lockHttpCredential.mockRejectedValue(new Error("A locked credential stays locked"))
    const onLocked = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN]} onLocked={onLocked} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /lock to this address/i }))
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("A locked credential stays locked"))
    expect(onLocked).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /lock to this address/i })).toBeInTheDocument()
  })

  it("cannot be closed while a lock is in flight — the retry must not fire behind a dismissed dialog", async () => {
    let resolveLock: (v: unknown) => void = () => {}
    apiMock.lockHttpCredential.mockReturnValue(new Promise((r) => { resolveLock = r }))
    const onClose = vi.fn()
    render(<CredentialLockDialog uses={[PLAIN]} onLocked={() => {}} onClose={onClose} />)
    fireEvent.click(lockButtons()[0])
    expect(screen.getByTestId("credential-lock-close")).toBeDisabled()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
    resolveLock({ data: {} })
    // The lock landed; closing is allowed again (the parent decides what happens next).
    await waitFor(() => expect(screen.getByTestId("credential-lock-close")).not.toBeDisabled())
    fireEvent.click(screen.getByTestId("credential-lock-close"))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("a later 409 starts from nothing: what was locked in the previous round is offered again, and nothing fires on its own", async () => {
    apiMock.lockHttpCredential.mockResolvedValue({ data: {} })
    const onLocked = vi.fn()
    const { rerender } = render(<CredentialLockDialog uses={[PLAIN]} onLocked={onLocked} onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: /lock to this address/i }))
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1))

    // The caller closes (uses → null) and a fresh 409 names the same credential.
    rerender(<CredentialLockDialog uses={null} onLocked={onLocked} onClose={() => {}} />)
    rerender(<CredentialLockDialog uses={[{ ...PLAIN }]} onLocked={onLocked} onClose={() => {}} />)
    expect(lockButtons()).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 20))
    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it("renders nothing when there is nothing to lock", () => {
    render(<CredentialLockDialog uses={null} onLocked={() => {}} onClose={() => {}} />)
    expect(screen.queryByText(/lock the credentials first/i)).toBeNull()
  })
})
