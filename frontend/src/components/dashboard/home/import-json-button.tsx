import { useRef } from "react"
import { Download, Loader2 } from "lucide-react"
import { useImportWorkflowJson } from "@/hooks/use-import-workflow-json"
import { useT } from "@/lib/i18n"

/**
 * "Import JSON" in the Jump back in header — pick a workflow export and land in
 * the editor with it.
 *
 * A bare button over a hidden file input rather than a dialog: the file picker
 * IS the choice, and the editor's own import dialog only exists to offer "add
 * to the open canvas", which this screen has no canvas for.
 *
 * It borrows the panel's own tokens (card fill, hairline border) instead of the
 * default outline button so it sits with the segmented control below it in both
 * themes, and the icon carries the brand colour the way the rest of the home
 * screen does.
 */
export function ImportJsonButton() {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const { importFile, isImporting } = useImportWorkflowJson()

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared before the await so picking the SAME file twice still fires
          // a change event — after a failed import that is the obvious retry.
          e.target.value = ""
          if (file) void importFile(file)
        }}
      />
      <button
        type="button"
        disabled={isImporting}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--home-line-2)] bg-[var(--home-card)] px-3.5 py-2 text-[13px] font-semibold text-[var(--home-strong)] transition-colors hover:bg-[var(--home-raised)] disabled:pointer-events-none disabled:opacity-60"
      >
        {isImporting ? (
          <Loader2 className="size-4 animate-spin text-[var(--primary)]" aria-hidden />
        ) : (
          <Download className="size-4 text-[var(--primary)]" aria-hidden />
        )}
        {t("dash.importJson")}
      </button>
    </>
  )
}
