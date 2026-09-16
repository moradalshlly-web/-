/**
 * Asia/Jerusalem wall-clock helpers for the founder notifications. DST-safe:
 * everything is derived from the formatted wall clock, never a hand-rolled
 * offset. Shared by the tick (digest hour) and the daily Loops pull.
 */

const IL_TZ = "Asia/Jerusalem"

export function israelParts(d: Date): { date: string; hour: number; secondsOfDay: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: IL_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p: Record<string, string> = {}
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value
  const hour = Number(p.hour) % 24 // en-CA can render midnight as "24"
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour,
    secondsOfDay: hour * 3600 + Number(p.minute) * 60 + Number(p.second),
  }
}

/** UTC instant of the most recent Israel midnight at/before d. */
export function startOfIsraelDayUtc(d: Date): Date {
  return new Date(d.getTime() - israelParts(d).secondsOfDay * 1000)
}
