import { useMemo, useSyncExternalStore } from "react"

/**
 * The current minute, shared by every subscriber: ONE timer for the whole
 * page, armed for just past each minute boundary, instead of an interval per
 * node card. The snapshot is the minute itself (ms floored to the minute), so
 * it is stable between renders and changes exactly when the clock does; the
 * `Date` handed out is memoised on it, so a `useMemo` keyed on `now` really
 * recomputes once a minute and not on every render.
 */

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function currentMinuteMs(): number {
  return Math.floor(Date.now() / 60_000) * 60_000
}

function arm(): void {
  const delay = 60_000 - (Date.now() % 60_000) + 50
  timer = setTimeout(() => {
    timer = null
    for (const listener of listeners) listener()
    // A listener may have unsubscribed while being notified: never re-arm
    // for nobody, or the timer would tick forever with no subscriber.
    if (listeners.size > 0 && timer === null) arm()
  }, delay)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) arm()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}

/** `new Date()` truncated to the minute, re-rendering once a minute. */
export function useNowMinute(): Date {
  const ms = useSyncExternalStore(subscribe, currentMinuteMs, currentMinuteMs)
  return useMemo(() => new Date(ms), [ms])
}
