import { Search, X } from "lucide-react"
import { useT } from "@/lib/i18n"

/** The search field on the browse header, 170px as designed. */
export function TemplateSearch({ value, onChange }: { readonly value: string; readonly onChange: (value: string) => void }) {
  const t = useT()
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--home-muted)]" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("templates.searchPlaceholder")}
        aria-label={t("templates.searchPlaceholder")}
        className="h-[34px] w-[170px] rounded-lg border border-[var(--home-line-2)] bg-transparent pe-7 ps-8 text-xs text-[var(--home-fg)] placeholder:text-[var(--home-muted)] focus:border-[var(--home-muted)] focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("templates.clearSearch")}
          className="absolute end-2 top-1/2 -translate-y-1/2 text-[var(--home-muted)] hover:text-[var(--home-fg)]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
