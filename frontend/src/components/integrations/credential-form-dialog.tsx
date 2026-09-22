import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n"
import type { HttpCredentialSummary } from "@/lib/api"

/**
 * One dialog, two jobs (plan D12):
 *   - `create` — name, header name, the secret (typed once, masked, never read
 *     back), and the optional lock ("only for this address" + "…and every
 *     address under it" = prefix).
 *   - `lock`   — set or move the address on an existing credential. The
 *     binding is a ratchet: it can be changed here, never removed.
 * The dialog only collects; the card owns the API calls, so a failure toast
 * and the list refresh live in one place.
 */
export interface CredentialFormValues {
  readonly name: string
  readonly headerName: string
  readonly secret: string
  readonly boundUrl: string | null
  readonly boundMatch: "exact" | "prefix"
}

interface Props {
  readonly open: boolean
  readonly mode: "create" | "lock"
  /** The credential being locked (mode `lock`); ignored for `create`. */
  readonly credential?: HttpCredentialSummary | null
  readonly saving: boolean
  readonly onSubmit: (values: CredentialFormValues) => void
  readonly onClose: () => void
}

const HEADER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

export function CredentialFormDialog({ open, mode, credential, saving, onSubmit, onClose }: Props) {
  const t = useT()
  const [name, setName] = useState("")
  const [headerName, setHeaderName] = useState("Authorization")
  const [secret, setSecret] = useState("")
  const [lock, setLock] = useState(mode === "lock")
  const [boundUrl, setBoundUrl] = useState("")
  const [prefix, setPrefix] = useState(false)

  // Reset per opening, and drop the secret the moment the dialog closes: the
  // card keeps this component mounted, and a plaintext key sitting in state for
  // the rest of the page's life is a leak into the next heap snapshot.
  useEffect(() => {
    if (!open) {
      setSecret("")
      return
    }
    setName("")
    setHeaderName("Authorization")
    setSecret("")
    setLock(mode === "lock")
    setBoundUrl(credential?.boundUrl ?? "")
    setPrefix(credential?.boundMatch === "prefix")
  }, [open, mode, credential])

  const isLockMode = mode === "lock"
  const urlOk = !lock || /^https:\/\/\S+$/i.test(boundUrl.trim())
  const canSubmit = isLockMode
    ? urlOk && boundUrl.trim().length > 0
    : name.trim().length > 0 && HEADER_NAME_RE.test(headerName.trim()) && secret.length > 0 && urlOk && !/[\r\n]/.test(secret)

  const submit = () => {
    if (!canSubmit || saving) return
    onSubmit({
      name: name.trim(),
      headerName: headerName.trim(),
      secret,
      boundUrl: lock ? boundUrl.trim() : null,
      boundMatch: prefix ? "prefix" : "exact",
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isLockMode ? (credential?.boundUrl ? t("creds.changeAddress") : t("creds.lock")) : t("creds.add")}</DialogTitle>
          <DialogDescription>{isLockMode ? t("creds.lockHint") : t("creds.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {!isLockMode && (
            <>
              <div>
                <Label htmlFor="cred-name">{t("creds.name")}</Label>
                <Input id="cred-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("creds.namePh")} maxLength={80} />
              </div>
              <div>
                <Label htmlFor="cred-header">{t("creds.headerName")}</Label>
                <Input id="cred-header" value={headerName} onChange={(e) => setHeaderName(e.target.value)} className="font-mono text-xs" maxLength={64} />
              </div>
              <div>
                <Label htmlFor="cred-secret">{t("creds.secret")}</Label>
                <Input
                  id="cred-secret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={t("creds.secretPh")}
                  className="font-mono text-xs"
                  maxLength={4096}
                />
                <p className="text-[10px] text-muted-foreground mt-1">{t("creds.secretHint")}</p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div>
                  <Label htmlFor="cred-lock" className="cursor-pointer">{t("creds.lockToggle")}</Label>
                  <p className="text-[10px] text-muted-foreground">{t("creds.lockHint")}</p>
                </div>
                <Switch id="cred-lock" checked={lock} onCheckedChange={setLock} />
              </div>
            </>
          )}

          {lock && (
            <>
              <div>
                <Label htmlFor="cred-url">{t("creds.boundUrl")}</Label>
                <Input
                  id="cred-url"
                  value={boundUrl}
                  onChange={(e) => setBoundUrl(e.target.value)}
                  placeholder="https://hooks.example.com/in/abc"
                  className="font-mono text-xs"
                  maxLength={2048}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="cred-prefix" className="cursor-pointer">{t("creds.prefixToggle")}</Label>
                  <p className="text-[10px] text-muted-foreground">{t("creds.prefixHint")}</p>
                </div>
                <Switch id="cred-prefix" checked={prefix} onCheckedChange={setPrefix} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>{t("creds.cancel")}</Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? t("creds.saving") : t("creds.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
