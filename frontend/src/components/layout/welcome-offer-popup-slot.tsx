/**
 * Core shim for the welcome-credits popup.
 *
 * Core may not statically import from `ee/`, so the popup arrives through
 * `lazy(() => import(...))` — the same pattern as `consent-gate-slot.tsx`.
 * On community/business builds `hasCredits()` is false, the import expression
 * is never evaluated, and the chunk is never requested. Inside an embed
 * (e.g. studio's iframe of app billing) the popup is suppressed entirely.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"
import { isEmbedded } from "@/hooks/use-embed-session-handoff"

let lazyPopup: ComponentType | null = null
function resolvePopup() {
  if (!hasCredits()) return null
  lazyPopup ??= lazy(() =>
    import("@/ee/components/welcome-offer/welcome-offer-popup").then((m) => ({ default: m.WelcomeOfferPopup })),
  )
  return lazyPopup
}

export function WelcomeOfferPopupSlot() {
  if (isEmbedded()) return null
  const Popup = resolvePopup()
  if (!Popup) return null
  return (
    <Suspense fallback={null}>
      <Popup />
    </Suspense>
  )
}
