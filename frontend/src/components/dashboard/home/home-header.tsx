import { useRef, type KeyboardEvent } from "react"
import { ArrowRight, Compass, Loader2, Plus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT, type MessageKey } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { HOME_PANEL_ID, homeTabId, type HomeTab } from "./home-tabs"

interface TabDef {
  readonly id: HomeTab
  readonly title: MessageKey
  readonly subtitle: MessageKey
  readonly Icon: LucideIcon
}

const TAB_DEFS: readonly TabDef[] = [
  { id: "continue", title: "home.tab.continue", subtitle: "home.tab.continueSub", Icon: ArrowRight },
  { id: "explore", title: "home.tab.explore", subtitle: "home.tab.exploreSub", Icon: Compass },
]

export interface HomeHeaderProps {
  readonly greeting: string
  readonly activeTab: HomeTab
  /** False when the surface profile leaves Explore no section to show. */
  readonly exploreVisible: boolean
  readonly onSelectTab: (tab: HomeTab) => void
  readonly onNewWorkflow: () => void
  readonly isCreating: boolean
}

/**
 * Greeting, the two notched tabs and the New Workflow pill. The active tab
 * shares the content panel's surface and border, and its `home-tab-active`
 * class paints the inverted corners that join it to the panel (globals.css).
 *
 * Sizes step down with the page's own width (container queries on the page
 * root), not the viewport's, so an expanded sidebar gets the compact header too.
 */
export function HomeHeader({
  greeting,
  activeTab,
  exploreVisible,
  onSelectTab,
  onNewWorkflow,
  isCreating,
}: HomeHeaderProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const tabs = exploreVisible ? TAB_DEFS : TAB_DEFS.filter((def) => def.id !== "explore")
  const tabRefs = useRef<Partial<Record<HomeTab, HTMLButtonElement | null>>>({})

  // Roving focus (WAI-ARIA tabs): arrows follow the reading direction, so in
  // RTL the left arrow moves to the next tab.
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = isRtl ? "ArrowLeft" : "ArrowRight"
    const back = isRtl ? "ArrowRight" : "ArrowLeft"
    const next =
      event.key === forward
        ? (index + 1) % tabs.length
        : event.key === back
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    const target = tabs[next].id
    onSelectTab(target)
    tabRefs.current[target]?.focus()
  }

  const createLabel = isCreating ? t("dash.creating") : t("dash.newWorkflow")

  return (
    <header className="flex h-[92px] flex-none items-end justify-between gap-4">
      <h1 className="min-w-0 truncate pb-[30px] text-[22px] font-semibold tracking-[-0.3px] text-[var(--home-strong)] @max-[760px]:text-[17px] @max-[600px]:hidden">
        {greeting}
      </h1>

      {/* ms-auto keeps the tabs on the end side once the greeting hides. */}
      <div className="ms-auto flex flex-none items-end gap-3 pe-5">
        <div role="tablist" aria-label={t("home.tabsLabel")} className="flex items-end gap-3">
          {tabs.map((def, index) => {
            const active = def.id === activeTab
            return (
              <button
                key={def.id}
                ref={(el) => {
                  tabRefs.current[def.id] = el
                }}
                type="button"
                role="tab"
                id={homeTabId(def.id)}
                aria-selected={active}
                aria-controls={HOME_PANEL_ID}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelectTab(def.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                className={cn(
                  "flex items-center gap-3.5 whitespace-nowrap ps-[18px] pe-[34px] text-start outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-[var(--primary)]",
                  "@max-[1000px]:gap-2.5 @max-[1000px]:ps-3.5 @max-[1000px]:pe-[22px] @max-[600px]:px-3.5",
                  active
                    ? "home-tab-active relative z-[2] -mb-px h-[70px] rounded-t-[18px] border border-b-0 border-[var(--home-line)] bg-[var(--home-panel)]"
                    : "mb-2.5 h-16 rounded-[18px] border border-[var(--home-line-2)] bg-[var(--home-card)] hover:bg-[var(--home-raised)]",
                )}
              >
                <span
                  className={cn(
                    "grid size-[34px] flex-none place-items-center rounded-full",
                    active ? "bg-[var(--home-raised-2)] text-[var(--primary)]" : "bg-[var(--home-raised)] text-[var(--home-fg-2)]",
                  )}
                >
                  <def.Icon
                    className={cn("size-4", def.id === "continue" && isRtl && "rotate-180")}
                    strokeWidth={2}
                    aria-hidden
                  />
                </span>
                <span className="@max-[600px]:sr-only">
                  <span
                    className={cn(
                      "block text-[15px] font-semibold leading-tight",
                      active ? "text-[var(--primary)]" : "text-[var(--home-fg)]",
                    )}
                  >
                    {t(def.title)}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--home-muted)] @max-[1000px]:hidden">
                    {t(def.subtitle)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onNewWorkflow}
          disabled={isCreating}
          aria-label={createLabel}
          className="mb-3.5 ms-2 flex h-14 items-center gap-2.5 whitespace-nowrap rounded-full bg-[var(--primary)] ps-[18px] pe-[22px] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(255,0,115,0.28)] transition-colors hover:bg-[var(--home-accent-hover)] disabled:opacity-70 @max-[1000px]:px-4"
        >
          {isCreating ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-5" strokeWidth={2} aria-hidden />
          )}
          <span className="@max-[1000px]:hidden">{createLabel}</span>
        </button>
      </div>
    </header>
  )
}
