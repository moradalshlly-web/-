import { useContext, useState } from "react"
import { QueryClientContext } from "@tanstack/react-query"
import { Lock, Loader2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import { queryKeys } from "@/lib/query-keys"
import { bindingAddressKey } from "@/lib/credential-address"
import { lockHttpCredential, type UnboundCredentialUse } from "@/lib/api"

/**
 * The publish / share gate's dialog (plan D3). The server answered 409
 * `credential_unbound` with one row per Webhook Output that cannot send in
 * front of strangers. Rows are grouped PER CREDENTIAL: a plain credential
 * used at exactly one address gets the one-click "Lock to this address";
 * everything else is explained, not "fixed" — a missing credential needs
 * another one picked in the node, a mismatched lock needs the node's URL
 * changed, and one plain credential used at several addresses needs a prefix
 * lock (Integrations) or a credential per node, because locking it to the
 * first address would silently break the others. "One address" means what
 * the server's lock means — origin + path — so two nodes that differ only by
 * a query string are one lock. `onLocked` fires from the lock that resolves
 * the last group, so the caller retries; a blocked group never auto-retries.
 */
interface Props {
  readonly uses: ReadonlyArray<UnboundCredentialUse> | null
  readonly onLocked: () => void
  readonly onClose: () => void
}

type GroupKind = "lockable" | "missing" | "mismatch" | "noUrl" | "multiUrl"

export interface CredentialGroup {
  readonly credentialId: string
  readonly credentialName: string | null
  readonly rows: ReadonlyArray<UnboundCredentialUse>
  readonly kind: GroupKind
  /** The one address a `lockable` group binds to (the first node's URL, as written); empty otherwise. */
  readonly url: string
  /** Rows of a `lockable` group whose URL has not been set yet — the lock does not speak for them. */
  readonly rowsWithoutUrl: ReadonlyArray<UnboundCredentialUse>
}

/** Pure: the gate's per-node rows folded into one decision per credential. */
export function groupUnboundUses(uses: ReadonlyArray<UnboundCredentialUse>): CredentialGroup[] {
  const byId = new Map<string, UnboundCredentialUse[]>()
  for (const use of uses) byId.set(use.credentialId, [...(byId.get(use.credentialId) ?? []), use])
  return [...byId.entries()].map(([credentialId, rows]) => {
    const withUrl = rows.filter((r) => r.nodeUrl.trim().length > 0)
    // Distinct ADDRESSES, not distinct strings: a query string is not part of a lock.
    const addresses = new Set(withUrl.map((r) => bindingAddressKey(r.nodeUrl) ?? r.nodeUrl.trim()))
    const kind: GroupKind = rows.some((r) => r.kind === "missing")
      ? "missing"
      : rows.some((r) => r.kind === "mismatch")
        ? "mismatch"
        : addresses.size === 0
          ? "noUrl"
          : addresses.size > 1
            ? "multiUrl"
            : "lockable"
    return {
      credentialId,
      credentialName: rows[0].credentialName,
      rows,
      kind,
      url: kind === "lockable" ? withUrl[0].nodeUrl.trim() : "",
      rowsWithoutUrl: kind === "lockable" ? rows.filter((r) => r.nodeUrl.trim().length === 0) : [],
    }
  })
}

const NO_IDS: ReadonlySet<string> = new Set()

export function CredentialLockDialog({ uses, onLocked, onClose }: Props) {
  const t = useT()
  // Optional on purpose: the dialog sits inside the app's provider, but a
  // caller rendered without one (tests, storybooks) must not throw.
  const queryClient = useContext(QueryClientContext)
  const [lockingId, setLockingId] = useState<string | null>(null)
  // Locked ids are remembered FOR the `uses` array they belong to: a later 409
  // arrives as a new array and starts from nothing — no reset effect, so no
  // render in which a stale set could count a fresh row as already done.
  const [locked, setLocked] = useState<{
    readonly of: ReadonlyArray<UnboundCredentialUse> | null
    readonly ids: ReadonlySet<string>
  }>({ of: null, ids: NO_IDS })
  const lockedIds = locked.of === uses ? locked.ids : NO_IDS

  const open = uses !== null && uses.length > 0
  const groups = groupUnboundUses(uses ?? [])
  const lockable = groups.filter((g) => g.kind === "lockable" && !lockedIds.has(g.credentialId))
  const blocked = groups.filter((g) => g.kind !== "lockable")
  const locking = lockingId !== null

  const lock = async (group: CredentialGroup) => {
    setLockingId(group.credentialId)
    try {
      await lockHttpCredential(group.credentialId, group.url)
      // Every open Webhook Output panel reads the same list: tell it the
      // credential is locked now, so its URL field follows without a reload.
      void queryClient?.invalidateQueries({ queryKey: queryKeys.httpCredentials.all })
      const ids = new Set([...lockedIds, group.credentialId])
      setLocked({ of: uses, ids })
      const unresolved = groups.some((g) => g.kind !== "lockable" || !ids.has(g.credentialId))
      if (!unresolved) {
        toast.success(t("credLock.done"))
        onLocked()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("credLock.failed"))
    } finally {
      setLockingId(null)
    }
  }

  const nameOf = (group: CredentialGroup) => group.credentialName ?? t("credLock.deletedCredential")
  const nodesOf = (rows: ReadonlyArray<UnboundCredentialUse>) => rows.map((r) => r.nodeLabel).join(", ")
  const noUrlReason = (row: UnboundCredentialUse) => (row.urlMapped ? t("credLock.mappedUrl") : t("credLock.noUrl"))
  const reasonOf = (group: CredentialGroup): string | null => {
    switch (group.kind) {
      case "missing": return t("credLock.missing")
      case "mismatch": return t("credLock.mismatch")
      case "multiUrl": return t("credLock.multiUrl", { n: group.rows.length })
      default: return null // noUrl: said per row below, each node for itself
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !locking) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t("credLock.title")}
          </DialogTitle>
          <DialogDescription>{t("credLock.desc")}</DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-2">
          {lockable.map((group) => (
            <li key={group.credentialId} className="rounded-md border border-border p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{nodesOf(group.rows.filter((r) => r.nodeUrl.trim().length > 0))}</p>
                <p className="text-[11px] text-muted-foreground truncate">{nameOf(group)}</p>
                <p className="text-[11px] font-mono text-muted-foreground truncate" title={group.url}>{group.url}</p>
                {group.rowsWithoutUrl.map((row) => (
                  <p key={row.nodeId} className="text-[11px] text-amber-700 dark:text-amber-400">
                    {row.nodeLabel}: {noUrlReason(row)}
                  </p>
                ))}
              </div>
              <Button size="sm" className="h-8 gap-1 shrink-0" disabled={locking} onClick={() => void lock(group)}>
                {lockingId === group.credentialId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                {lockingId === group.credentialId ? t("credLock.locking") : t("credLock.lockTo")}
              </Button>
            </li>
          ))}
          {blocked.map((group) => (
            <li key={`${group.credentialId}:blocked`} className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{nodesOf(group.rows)}</p>
                <p className="text-[11px] text-muted-foreground truncate">{nameOf(group)}</p>
                {group.kind === "noUrl"
                  ? group.rows.map((row) => (
                      <p key={row.nodeId} className="text-[11px] text-muted-foreground">
                        {group.rows.length > 1 ? `${row.nodeLabel}: ` : ""}{noUrlReason(row)}
                      </p>
                    ))
                  : <p className="text-[11px] text-muted-foreground">{reasonOf(group)}</p>}
              </div>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button variant="outline" data-testid="credential-lock-close" onClick={onClose} disabled={locking}>{t("credLock.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
