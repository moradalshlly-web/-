import { useState } from "react"
import { Check, Copy, X } from "lucide-react"
import { useT } from "@/lib/i18n"
import { inspectorFields, inspectorSettings, type InspectorField, type InspectorNode } from "./node-inspector-fields"

const COPIED_MS = 1500

function nodeTitle(node: InspectorNode): string {
  const { label, title } = node.data
  if (typeof label === "string" && label.trim()) return label
  if (typeof title === "string" && title.trim()) return title
  return node.type ?? node.id
}

function FieldBlock({ field }: { readonly field: InspectorField }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(field.value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      // No clipboard (insecure context, denied permission): the text below
      // stays selectable, which is the fallback the reader already has.
    }
  }
  return (
    <section className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-[var(--home-muted)]">{field.label}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--home-muted)] transition-colors hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? t("templates.inspector.copied") : t("templates.inspector.copy")}
        </button>
      </div>
      <p className="select-text whitespace-pre-wrap break-words rounded-lg bg-[var(--home-raised)] px-3 py-2 leading-relaxed text-[var(--home-fg)]">{field.value}</p>
    </section>
  )
}

/**
 * The read-only canvas's answer to "I can see the node but not its prompt":
 * a panel with every long text field of one node in full — prompt, negative
 * prompt, system and user prompts, a note's body, a generated result — plus
 * the short settings as chips. Reading and copying only; nothing here can
 * touch the template.
 */
export function NodeInspector({ node, onClose }: { readonly node: InspectorNode; readonly onClose: () => void }) {
  const t = useT()
  const title = nodeTitle(node)
  const fields = inspectorFields(node)
  const settings = inspectorSettings(node)
  return (
    <aside
      role="dialog"
      aria-label={title}
      className="absolute bottom-[18px] start-[18px] top-[64px] z-10 flex w-[380px] max-w-[calc(100%-36px)] flex-col overflow-hidden rounded-[14px] border border-[var(--home-line)] bg-[var(--home-panel)] text-[13px] text-[var(--home-fg)] shadow-xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--home-line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[var(--home-strong)]">{title}</div>
          <div className="text-[11px] text-[var(--home-muted)]">{node.type}</div>
        </div>
        <button
          type="button"
          aria-label={t("templates.inspector.close")}
          onClick={onClose}
          className="grid size-7 flex-none place-items-center rounded-md text-[var(--home-muted)] transition-colors hover:bg-[var(--home-raised)] hover:text-[var(--home-fg)]"
        >
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {settings.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {settings.map((s) => (
              <span key={s.label} className="rounded-md bg-[var(--home-raised)] px-2 py-0.5 text-[11px] text-[var(--home-fg-2)]">
                <span className="text-[var(--home-muted)]">{s.label} · </span>
                {s.value}
              </span>
            ))}
          </div>
        )}
        {fields.length === 0 && <p className="text-[var(--home-muted)]">{t("templates.inspector.empty")}</p>}
        {fields.map((f) => (
          <FieldBlock key={f.key} field={f} />
        ))}
      </div>
    </aside>
  )
}
