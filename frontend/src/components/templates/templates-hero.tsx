import { useState } from "react"
import { CachedImage } from "@/components/ui/cached-image"
import { PreviewVideo } from "@/components/ui/preview-video"
import { CreditGate } from "@/components/ui/credit-cost"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { surfaceBrandName } from "@/lib/surface-selectors"
import { useT } from "@/lib/i18n"

const HOW_STEPS = ["templates.howStep1", "templates.howStep2", "templates.howStep3"] as const

/**
 * The banner at the top of the Templates page: title, one line of pitch, the
 * two pills, and an illustration slot filled by the cover of the top template
 * (stripes when none has media yet).
 */
export function TemplatesHero({
  onBrowseAll,
  cover,
}: {
  readonly onBrowseAll: () => void
  readonly cover: { readonly url: string; readonly type: string | null } | null
}) {
  const t = useT()
  const [howOpen, setHowOpen] = useState(false)

  return (
    <section className="templates-dots flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-[var(--home-line)] bg-[var(--home-panel)] px-7 py-7 sm:px-9 sm:py-8">
      <div className="min-w-0 max-w-[520px]">
        <h2 className="text-[28px] font-bold leading-tight tracking-[-0.4px] text-[var(--home-strong)]">
          {t("templates.heroTitle", { brand: surfaceBrandName() })}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--home-muted)]">{t("templates.heroSubtitle")}</p>
        <div className="mt-[18px] flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onBrowseAll}
            className="whitespace-nowrap rounded-full bg-[var(--primary)] px-4 py-[9px] text-[13px] font-bold text-white transition-colors hover:bg-[var(--home-accent-hover)]"
          >
            {t("templates.browseAll")}
          </button>
          <button
            type="button"
            onClick={() => setHowOpen(true)}
            className="whitespace-nowrap rounded-full border border-[var(--home-line)] px-4 py-[9px] text-[13px] font-semibold text-[var(--home-strong)] transition-colors hover:bg-[var(--home-raised)]"
          >
            {t("templates.howButton")}
          </button>
        </div>
      </div>

      <div className="home-stripes relative aspect-video w-[220px] flex-none overflow-hidden rounded-xl border border-[var(--home-line-2)]" aria-hidden>
        {cover &&
          (cover.type === "video" ? (
            <PreviewVideo src={cover.url} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <CachedImage src={cover.url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" thumbnail />
          ))}
      </div>

      <Dialog open={howOpen} onOpenChange={setHowOpen}>
        <DialogContent className="templates-page border-[var(--home-line)] bg-[var(--home-panel)] text-[var(--home-fg)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("templates.howButton")}</DialogTitle>
            <DialogDescription className="sr-only">{t("templates.heroSubtitle")}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3">
            {HOW_STEPS.map((key, index) => (
              <li key={key} className="flex gap-3 text-sm leading-relaxed text-[var(--home-fg-2)]">
                <span className="flex-none pt-0.5 font-mono text-[11px] text-[var(--primary)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  {t(key)}
                  {index === HOW_STEPS.length - 1 && (
                    <CreditGate>
                      <span> {t("templates.howStep3Credits")}</span>
                    </CreditGate>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </section>
  )
}
