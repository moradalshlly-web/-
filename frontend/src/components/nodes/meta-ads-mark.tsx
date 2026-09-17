import { useId } from "react"

/**
 * Meta "infinity" mark — a stand-in stroke path with the brand gradient
 * (#0081FB → #A033FF → #FF5C87), per the design handoff. The gradient id is
 * per-instance so several marks on one canvas never share (and clobber) it.
 */
export function MetaMark({ width = 26, height = 16, className }: { readonly width?: number; readonly height?: number; readonly className?: string }) {
  const gradientId = useId()
  return (
    <svg width={width} height={height} viewBox="0 0 32 20" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1">
          <stop offset="0" stopColor="#0081FB" />
          <stop offset=".55" stopColor="#A033FF" />
          <stop offset="1" stopColor="#FF5C87" />
        </linearGradient>
      </defs>
      <path
        d="M6 10 C6 5 9 4 11 4 C15 4 17 16 21 16 C24 16 26 14 26 10 C26 6 24 4 21 4 C17 4 15 16 11 16 C9 16 6 15 6 10 Z"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
