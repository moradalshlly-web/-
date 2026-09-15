/**
 * Core shim for the welcome-credits banner at the top of the Continue tab.
 *
 * Same lazy-import pattern as `free-grant-banner-slot.tsx`: core never
 * statically imports `ee/`, community builds never request the chunk, and the
 * banner itself renders nothing unless the balance says the offer applies.
 */
import { Suspense, lazy, type ComponentType } from "react"
import { hasCredits } from "@/lib/edition"

let lazyBanner: ComponentType | null = null
function resolveBanner() {
  if (!hasCredits()) return null
  lazyBanner ??= lazy(() =>
    import("@/ee/components/welcome-offer/welcome-offer-banner").then((m) => ({ default: m.WelcomeOfferBanner })),
  )
  return lazyBanner
}

export function WelcomeOfferBannerSlot() {
  const Banner = resolveBanner()
  if (!Banner) return null
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  )
}
