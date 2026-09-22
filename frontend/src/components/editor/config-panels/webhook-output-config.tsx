"use client"

import { Link } from "react-router-dom"
import { AlertTriangle, Plus, Trash2 } from "lucide-react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { sameBindingAddress } from "@/lib/credential-address"
import { useHttpCredentials } from "@/hooks/use-http-credentials"
import type { WebhookOutputData, WebhookParam } from "@/types/nodes"
import type { ConfigProps } from "./types"

const NO_CREDENTIAL = "__none__"

/**
 * Webhook Output — the URL, the stored credential it sends with, and the
 * input parameters.
 *
 * Picking a credential that is locked to an EXACT address makes the URL
 * follow it: the field is prefilled on that pick (unless the URL already IS
 * that address — a query string on it is kept) and stays disabled, so the
 * send can never aim the key elsewhere. A stored URL that is a different
 * address than the lock (the credential was moved from Integrations, the
 * workflow was imported) is shown as a warning with a one-click fix — never
 * written on mount, which would dirty the workflow for opening the panel.
 * "Same address" means what the server means: origin + path, so a URL that
 * differs only by its query is never flagged. A prefix-locked credential
 * leaves the URL editable under the prefix; a plain one only works on the
 * owner's own runs (the publish / share gate says so).
 */
/**
 * Node types that run the workflow with nobody at the editor. A plain
 * credential is refused on every such run except a schedule whose node the
 * owner ADDED here (the editor's own sync vouches for it); a schedule that
 * came with the workflow, and every webhook / Telegram trigger, need a lock.
 * The panel cannot tell which schedule is which, so it says both.
 */
const UNATTENDED_TRIGGER_TYPES: ReadonlySet<string> = new Set(["schedule-trigger", "webhook-trigger", "telegram-trigger"])

export function WebhookOutputConfig({ data, onUpdate, nodes }: ConfigProps<WebhookOutputData>) {
  const t = useT()
  const params = data.params ?? []
  const runsUnattended = (nodes ?? []).some((n) => UNATTENDED_TRIGGER_TYPES.has(n.type ?? ""))

  const { credentials, loading: credentialsLoading, error: credentialsError } = useHttpCredentials()
  const credentialId = typeof data.credentialId === "string" && data.credentialId ? data.credentialId : ""
  const credential = credentials.find((c) => c.id === credentialId)
  // "Missing" is a verdict, not a guess: not while loading, not when the list failed to load.
  const credentialMissing = credentialId !== "" && !credentialsLoading && !credentialsError && !credential
  const lockedUrl = credential?.boundUrl && credential.boundMatch === "exact" ? credential.boundUrl : null
  const urlMismatch = lockedUrl !== null && !sameBindingAddress(data.url, lockedUrl)
  // A stored credential may turn out to lock the URL once the list lands;
  // a keystroke in that window would be persisted and then flagged.
  const urlDisabled = lockedUrl !== null || (credentialId !== "" && credentialsLoading)

  const addParam = () => {
    onUpdate({
      params: [...params, { id: nanoid(), name: "", type: "text" }],
    })
  }

  const updateParam = (index: number, patch: Partial<WebhookParam>) => {
    const updated = params.map((p, i) => (i === index ? { ...p, ...patch } : p))
    onUpdate({ params: updated })
  }

  const removeParam = (index: number) => {
    onUpdate({ params: params.filter((_, i) => i !== index) })
  }

  const urlHint = lockedUrl
    ? t("utilcfg.webhookCredentialLocked")
    : credential?.boundUrl && credential.boundMatch === "prefix"
      ? t("utilcfg.webhookCredentialPrefix", { prefix: credential.boundUrl })
      : t("utilcfg.webhookUrlHint")

  const credentialHint = credentialsError
    ? t("utilcfg.webhookCredentialLoadFailed")
    : credentialMissing
      ? t("utilcfg.webhookCredentialMissing")
      : credential && !credential.boundUrl
        ? (runsUnattended ? t("utilcfg.webhookCredentialPlainUnattended") : t("utilcfg.webhookCredentialPlain"))
        : t("utilcfg.webhookCredentialHint")

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-url">{t("utilcfg.webhookUrl")}</Label>
        <Input
          id="webhook-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/webhook"
          className="text-xs font-mono"
          disabled={urlDisabled}
          aria-readonly={urlDisabled}
        />
        {urlMismatch ? (
          <div role="alert" className="mt-1 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-2 py-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-amber-800 dark:text-amber-300">{t("utilcfg.webhookCredentialUrlMismatch")}</p>
              <p className="text-[10px] font-mono text-muted-foreground truncate" title={lockedUrl}>{lockedUrl}</p>
            </div>
            <Button variant="outline" size="sm" className="h-6 text-[10px] shrink-0" onClick={() => onUpdate({ url: lockedUrl })}>
              {t("utilcfg.webhookUseLockedUrl")}
            </Button>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground mt-1">{urlHint}</p>
        )}
      </div>

      <div>
        <Label htmlFor="webhook-credential">{t("utilcfg.webhookCredential")}</Label>
        <Select
          value={credentialId || NO_CREDENTIAL}
          onValueChange={(v) => {
            const next = credentials.find((c) => c.id === v)
            const nextLock = next?.boundUrl && next.boundMatch === "exact" ? next.boundUrl : null
            onUpdate({
              credentialId: v === NO_CREDENTIAL ? undefined : v,
              // Prefill only when the URL is not already that address — a
              // query string on a URL that already matches is kept.
              ...(nextLock && !sameBindingAddress(data.url, nextLock) ? { url: nextLock } : {}),
            })
          }}
        >
          <SelectTrigger id="webhook-credential" className="h-8 text-xs">
            <SelectValue placeholder={t("utilcfg.webhookCredentialNone")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CREDENTIAL}>{t("utilcfg.webhookCredentialNone")}</SelectItem>
            {credentials.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} · {c.headerName}
              </SelectItem>
            ))}
            {credentialId !== "" && !credential && (
              <SelectItem value={credentialId}>
                {credentialMissing ? t("utilcfg.webhookCredentialMissingOption") : t("utilcfg.webhookCredentialNone")}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {credentialHint}{" "}
          <Link to="/integrations" className="underline underline-offset-2">
            {t("utilcfg.webhookCredentialManage")}
          </Link>
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label>{t("utilcfg.inputParameters")}</Label>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addParam}>
            <Plus className="h-3 w-3" />
            {t("cfgshared.add")}
          </Button>
        </div>

        {params.length === 0 && (
          <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
            {t("utilcfg.noParamsDefined")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {params.map((param, i) => (
            <div key={param.id} className="flex items-center gap-1.5">
              <Input
                value={param.name}
                onChange={(e) => updateParam(i, { name: e.target.value })}
                placeholder={t("utilcfg.phParamName")}
                className="text-xs h-8 flex-1"
              />
              <Select
                value={param.type}
                onValueChange={(v) => updateParam(i, { type: v as WebhookParam["type"] })}
              >
                <SelectTrigger className="h-8 w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("field.text")}</SelectItem>
                  <SelectItem value="imageUrl">{t("utilcfg.imageUrl")}</SelectItem>
                  <SelectItem value="videoUrl">{t("utilcfg.videoUrl")}</SelectItem>
                  <SelectItem value="audioUrl">{t("utilcfg.audioUrl")}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeParam(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
