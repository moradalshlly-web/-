import { useState } from "react"
import { KeyRound, Loader2, Lock, LockOpen, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useT } from "@/lib/i18n"
import {
  createHttpCredential,
  deleteHttpCredential,
  isEncryptionKeyMissingError,
  updateHttpCredential,
  type HttpCredentialSummary,
} from "@/lib/api"
import { useHttpCredentials } from "@/hooks/use-http-credentials"
import { CredentialFormDialog, type CredentialFormValues } from "./credential-form-dialog"

/**
 * Integrations → HTTP credentials: the keys a Webhook Output can send with.
 * Saved once, encrypted on the server, never shown again (plan D12). A row is
 * PLAIN (works on the owner's own runs only) until it is LOCKED to an address,
 * which a published app or a shared workflow requires.
 */
export function CredentialsCard() {
  const t = useT()
  const { credentials, loading, error, refresh } = useHttpCredentials()
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "lock"; credential: HttpCredentialSummary } | null>(null)
  const [saving, setSaving] = useState(false)
  const [encryptionMissing, setEncryptionMissing] = useState(false)
  const [deleting, setDeleting] = useState<HttpCredentialSummary | null>(null)

  const submit = async (values: CredentialFormValues) => {
    if (!dialog) return
    setSaving(true)
    try {
      if (dialog.mode === "create") {
        await createHttpCredential({
          name: values.name,
          headerName: values.headerName,
          secret: values.secret,
          boundUrl: values.boundUrl,
          boundMatch: values.boundMatch,
        })
        toast.success(t("creds.created"))
      } else {
        await updateHttpCredential(dialog.credential.id, { boundUrl: values.boundUrl, boundMatch: values.boundMatch })
        toast.success(t("creds.locked"))
      }
      setEncryptionMissing(false)
      setDialog(null)
      await refresh()
    } catch (err) {
      setEncryptionMissing(isEncryptionKeyMissingError(err))
      toast.error(err instanceof Error ? err.message : t("creds.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    try {
      await deleteHttpCredential(target.id)
      toast.success(t("creds.deleted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("creds.saveFailed"))
    }
    await refresh()
  }

  return (
    <section
      aria-labelledby="http-credentials-heading"
      className="mb-6 rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-5 flex flex-col gap-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ff0073]/10 text-[#ff0073]">
          <KeyRound className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 id="http-credentials-heading" className="font-semibold text-gray-900 dark:text-white text-sm">
              {t("creds.title")}
            </h3>
            {credentials.length > 0 && (
              <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                {t("creds.count", { n: credentials.length })}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t("creds.subtitle")}</p>
        </div>
        <Button size="sm" className="h-8 gap-1 shrink-0" onClick={() => setDialog({ mode: "create" })}>
          <Plus className="h-3.5 w-3.5" />
          {t("creds.add")}
        </Button>
      </div>

      {encryptionMissing && (
        <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-400">
          {t("creds.encryptionMissing")}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("creds.loading")}
        </div>
      ) : error ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("creds.loadFailed")}</p>
      ) : credentials.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t("creds.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100 dark:divide-[#2D2D2D]">
          {credentials.map((cred) => (
            <li key={cred.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{cred.name}</span>
                  <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{cred.headerName}</span>
                  {cred.boundUrl ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                      <Lock className="h-3 w-3" />
                      {cred.boundMatch === "prefix" ? t("creds.prefixBadge") : t("creds.lockedBadge")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                      <LockOpen className="h-3 w-3" />
                      {t("creds.unlockedBadge")}
                    </span>
                  )}
                </div>
                {cred.boundUrl && (
                  <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 truncate" title={cred.boundUrl}>
                    {cred.boundUrl}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setDialog({ mode: "lock", credential: cred })}
                aria-label={`${cred.boundUrl ? t("creds.changeAddress") : t("creds.lock")}: ${cred.name}`}
              >
                <Lock className="h-3 w-3" />
                {cred.boundUrl ? t("creds.changeAddress") : t("creds.lock")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => setDeleting(cred)}
                aria-label={`${t("creds.delete")}: ${cred.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <CredentialFormDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        credential={dialog?.mode === "lock" ? dialog.credential : null}
        saving={saving}
        onSubmit={submit}
        onClose={() => { if (!saving) setDialog(null) }}
      />
      <DeleteConfirmationDialog
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={t("creds.deleteTitle")}
        description={t("creds.deleteDesc")}
      />
    </section>
  )
}
