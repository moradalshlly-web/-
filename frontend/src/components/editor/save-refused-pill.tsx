import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { useT } from "@/lib/i18n"

/**
 * The standing notice over a canvas whose saves the server refuses.
 *
 * The toast that announces a refusal is gone in ten seconds; the state it
 * announces lasts until the person leaves. Everything still responds — nodes
 * run, results appear — so without something that stays on screen the canvas
 * looks exactly like one that is being saved.
 *
 * Read-only is a different state with its own pill, and it wins: a read-only
 * canvas never attempts a save, so it can never be refused one.
 */
export function SaveRefusedPill() {
  const t = useT()
  const refused = useWorkflowStore((s) => !s.isReadOnly && isSaveRefused(s))
  if (!refused) return null
  return (
    <div
      role="status"
      className="absolute top-4 left-1/2 -translate-x-1/2 z-40 max-w-[min(90%,46rem)] rounded-2xl border border-[#ff0073]/40 bg-background/90 px-4 py-1.5 text-center text-xs text-muted-foreground shadow-sm backdrop-blur pointer-events-none"
    >
      {t("editor.notWritableReason")}
    </div>
  )
}
