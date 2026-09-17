"use client"

import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { CachedImage } from "@/components/ui/cached-image"
import { cn } from "@/lib/utils"

/** The striped placeholder every Meta Ads media slot shows before (or instead of) the creative. */
export const META_AD_STRIPES: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--meta-ads-stripe-a) 0 10px, var(--meta-ads-stripe-b) 10px 20px)",
}

/**
 * One ad creative slot: striped placeholder + the advertiser's initial
 * immediately, the preview image only once it has actually loaded. Meta's
 * CDN urls are signed and expire, so a failed load keeps the placeholder —
 * a broken-image glyph is never shown. `CachedImage` routes fbcdn through
 * our image proxy (the CDN blocks direct cross-origin loads).
 */
export function MetaAdMedia({
  src,
  initial,
  className,
  initialClassName,
  children,
}: {
  readonly src: string | null
  readonly initial: string
  readonly className?: string
  readonly initialClassName?: string
  readonly children?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  return (
    <div className={cn("relative overflow-hidden", className)} style={META_AD_STRIPES}>
      {!loaded && (
        <div className={cn("absolute inset-0 grid place-items-center font-extrabold text-[var(--meta-ads-faint)] select-none", initialClassName)}>
          {initial}
        </div>
      )}
      {src && !failed && (
        <CachedImage
          src={src}
          alt=""
          noPlaceholder
          draggable={false}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")}
          onLoadDimensions={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {children}
    </div>
  )
}
