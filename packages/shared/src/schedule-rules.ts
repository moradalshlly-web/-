/**
 * Schedule Trigger rules — the ONE model both sides read.
 *
 * A schedule is a list of rules; the workflow runs whenever any rule says
 * "this minute". The editor previews a schedule (headline, today's timeline,
 * the next runs, runs per day) and the server decides whether to fire — from
 * the same functions here, so what the panel shows is what the cron does.
 *
 * Kinds, with the fields each reads (everything else on the rule is ignored):
 * - `minutes` — `every` (1–59): at minute 0, N, 2N… of every hour (cron `*\/N`).
 * - `hours`   — `every` (1–23) at `minute`: at hour 0, N, 2N… of every day.
 * - `days`    — `every` (1–31) at `hour:minute`: every Nth calendar day.
 * - `weeks`   — `every` (1–52) on `weekdays` at `hour:minute`: every Nth week.
 * - `months`  — `every` (1–12) on `dayOfMonth` at `hour:minute`: every Nth month
 *               (a day the month lacks — 31 in April — runs on its last day).
 * - `cron`    — a 5-field cron expression, for the person who wants one.
 *
 * "Every Nth day / week / month" counts from a fixed origin (the Unix epoch,
 * in the schedule's timezone; weeks start on Monday) rather than from the
 * moment the rule was saved — so the preview and the server agree, a re-save
 * never shifts the phase, and two people reading the rule get the same days.
 *
 * Time is read in the schedule's timezone (an IANA name; missing or unknown
 * → UTC — callers validate with `isValidTimezone` and refuse the unknown
 * ones, so that fallback is only ever a defence). Resolution is one minute:
 * the cron ticks once a minute and asks "does this minute match?" — there is
 * no sub-minute scheduling.
 *
 * Daylight-saving: a wall-clock minute that does not exist on the day the
 * clocks jump forward is skipped that day. On the day they fall back, a rule
 * that names a time of day (`hours` / `days` / `weeks` / `months` / `cron`)
 * runs once — the second pass is the same wall-clock minute
 * (`localMinuteKey`) as the fire just before it, and both the server and the
 * preview drop it — while a `minutes` rule keeps its cadence through the
 * repeated hour, because real time keeps passing.
 */

export const SCHEDULE_RULE_KINDS = ["minutes", "hours", "days", "weeks", "months", "cron"] as const
export type ScheduleRuleKind = (typeof SCHEDULE_RULE_KINDS)[number]

export interface ScheduleRule {
  readonly id: string
  readonly kind: ScheduleRuleKind
  /** Every N units (see `SCHEDULE_EVERY_LIMITS`). */
  readonly every?: number
  /** 0–23, in the schedule's timezone. Read by days / weeks / months. */
  readonly hour?: number
  /** 0–59. Read by every kind but `minutes` and `cron`. */
  readonly minute?: number
  /** 0 = Sunday … 6 = Saturday (the cron / JavaScript convention). Read by `weeks`. */
  readonly weekdays?: ReadonlyArray<number>
  /** 1–31. Read by `months`. */
  readonly dayOfMonth?: number
  /** A 5-field cron expression. Read by `cron`. */
  readonly cron?: string
}

export interface ScheduleSpec {
  readonly rules: ReadonlyArray<ScheduleRule>
  /** IANA timezone; missing or unknown means UTC. */
  readonly timezone?: string
  /** Stop after this many runs; missing means unlimited. */
  readonly maxExecutions?: number
}

/** `every` limits per kind — the panel's range hints and the normaliser's clamps. */
export const SCHEDULE_EVERY_LIMITS: Readonly<Record<Exclude<ScheduleRuleKind, "cron">, readonly [number, number]>> = {
  minutes: [1, 59],
  hours: [1, 23],
  days: [1, 31],
  weeks: [1, 52],
  months: [1, 12],
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function int(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return parseInt(value.trim(), 10)
  return null
}

function clamp(value: number | null, lo: number, hi: number, fallback: number): number {
  if (value === null) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/** A count of units: zero or less is "not typed yet", never "every minute". */
function positiveInt(value: unknown): number | null {
  const n = int(value)
  return n !== null && n >= 1 ? n : null
}

/** A 5-field cron expression — the only shape the matcher understands. */
export function isCronExpression(value: unknown): value is string {
  return typeof value === "string" && value.trim().split(/\s+/).filter(Boolean).length === 5
}

/**
 * One rule as the user typed it → one rule the engine can run, or `null` when
 * there is nothing to run (unknown kind, a cron rule with no expression, a
 * weeks rule with no weekday). Out-of-range numbers are clamped, never
 * refused: a half-typed "0" must not silently disable a schedule.
 */
export function normalizeScheduleRule(raw: unknown, fallbackId = "rule-1"): ScheduleRule | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.kind !== "string" || !(SCHEDULE_RULE_KINDS as readonly string[]).includes(r.kind)) return null
  const kind = r.kind as ScheduleRuleKind
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : fallbackId
  const minute = clamp(int(r.minute), 0, 59, 0)
  const hour = clamp(int(r.hour), 0, 23, 0)
  switch (kind) {
    case "minutes":
      return { id, kind, every: clamp(positiveInt(r.every),...SCHEDULE_EVERY_LIMITS.minutes, 5) }
    case "hours":
      return { id, kind, every: clamp(positiveInt(r.every),...SCHEDULE_EVERY_LIMITS.hours, 1), minute }
    case "days":
      return { id, kind, every: clamp(positiveInt(r.every),...SCHEDULE_EVERY_LIMITS.days, 1), hour, minute }
    case "weeks": {
      const weekdays = Array.isArray(r.weekdays)
        ? [...new Set(r.weekdays.map(int).filter((d): d is number => d !== null && d >= 0 && d <= 6))].sort((a, b) => a - b)
        : []
      if (weekdays.length === 0) return null
      return { id, kind, every: clamp(positiveInt(r.every),...SCHEDULE_EVERY_LIMITS.weeks, 1), hour, minute, weekdays }
    }
    case "months":
      return {
        id,
        kind,
        every: clamp(positiveInt(r.every),...SCHEDULE_EVERY_LIMITS.months, 1),
        hour,
        minute,
        dayOfMonth: clamp(int(r.dayOfMonth), 1, 31, 1),
      }
    case "cron": {
      const cron = typeof r.cron === "string" ? r.cron.trim().split(/\s+/).join(" ") : ""
      return isCronExpression(cron) ? { id, kind, cron } : null
    }
  }
}

/** Every usable rule, in order; unusable ones dropped. */
export function normalizeScheduleRules(raw: unknown): ScheduleRule[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r, i) => normalizeScheduleRule(r, `rule-${i + 1}`)).filter((r): r is ScheduleRule => r !== null)
}

/**
 * The schedule an OLD node carried — `interval` ("5m" / "1h" / "1d" or one of
 * the editor's cron presets) and/or `cron` — as rules. Seconds cannot be
 * scheduled (the cron ticks once a minute) and become "every minute".
 */
export function legacyScheduleToRules(data: { interval?: unknown; cron?: unknown; cronExpression?: unknown }): ScheduleRule[] {
  const interval = typeof data.interval === "string" ? data.interval.trim() : ""
  const explicit = [data.cron, data.cronExpression].find((v): v is string => typeof v === "string" && v.trim() !== "")?.trim() ?? ""
  const m = interval.match(/^(\d+)([smhd])$/)
  if (m) {
    const n = parseInt(m[1], 10)
    // "0m" never fired (it parsed to 0 ms); it must not start firing now.
    if (n < 1) return []
    switch (m[2]) {
      case "s": return [{ id: "rule-1", kind: "minutes", every: 1 }]
      case "m": return n < 60
        ? [{ id: "rule-1", kind: "minutes", every: n }]
        : [{ id: "rule-1", kind: "hours", every: Math.min(23, Math.max(1, Math.round(n / 60))), minute: 0 }]
      case "h": return n < 24
        ? [{ id: "rule-1", kind: "hours", every: n, minute: 0 }]
        : [{ id: "rule-1", kind: "days", every: Math.min(31, Math.max(1, Math.round(n / 24))), hour: 0, minute: 0 }]
      default: return [{ id: "rule-1", kind: "days", every: Math.min(31, n), hour: 0, minute: 0 }]
    }
  }
  const expression = interval === "" || interval === "custom" ? explicit : interval
  if (!isCronExpression(expression)) return []
  const fromCron = cronToRule(expression)
  // Through the normaliser like every other rule: a cron nobody could say in
  // words ("0 9 * * 5-0" — an empty weekday set) must come out as "not
  // configured", never as a rule that silently matches nothing or everything.
  return normalizeScheduleRules([fromCron ?? { id: "rule-1", kind: "cron", cron: expression.split(/\s+/).join(" ") }])
}

/** A cron step; a zero or negative step is not a step (it never matched before either). */
function cronStep(field: string): number | null {
  const m = field.match(/^\*\/(\d+)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 ? n : null
}

/** The plain shapes a cron expression can be said in words; anything else stays a cron rule. */
function cronToRule(expression: string): ScheduleRule | null {
  const [min, hour, dom, month, dow] = expression.trim().split(/\s+/)
  if (month !== "*") return null
  const minN = /^\d+$/.test(min) ? parseInt(min, 10) : null
  const hourN = /^\d+$/.test(hour) ? parseInt(hour, 10) : null
  const stepMin = cronStep(min)
  const stepHour = cronStep(hour)
  if (stepMin !== null && hour === "*" && dom === "*" && dow === "*") return { id: "rule-1", kind: "minutes", every: stepMin }
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return { id: "rule-1", kind: "minutes", every: 1 }
  if (minN !== null && stepHour !== null && dom === "*" && dow === "*") return { id: "rule-1", kind: "hours", every: stepHour, minute: minN }
  if (minN !== null && hour === "*" && dom === "*" && dow === "*") return { id: "rule-1", kind: "hours", every: 1, minute: minN }
  if (minN !== null && hourN !== null && dom === "*" && dow === "*") return { id: "rule-1", kind: "days", every: 1, hour: hourN, minute: minN }
  if (minN !== null && hourN !== null && dom === "*" && /^[0-6](,[0-6])*$|^[0-6]-[0-6]$/.test(dow)) {
    const weekdays = dow.includes("-")
      ? (() => { const [a, b] = dow.split("-").map(Number); return Array.from({ length: b - a + 1 }, (_, i) => a + i) })()
      : dow.split(",").map(Number)
    return { id: "rule-1", kind: "weeks", every: 1, hour: hourN, minute: minN, weekdays }
  }
  if (minN !== null && hourN !== null && /^\d+$/.test(dom) && dow === "*") {
    return { id: "rule-1", kind: "months", every: 1, hour: hourN, minute: minN, dayOfMonth: parseInt(dom, 10) }
  }
  return null
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

export interface LocalTime {
  readonly year: number
  /** 1–12 */
  readonly month: number
  /** 1–31 */
  readonly day: number
  readonly hour: number
  readonly minute: number
  /** 0 = Sunday … 6 = Saturday */
  readonly weekday: number
  /** Calendar days since 1970-01-01, in the schedule's timezone. */
  readonly epochDay: number
}

/**
 * Formatters are cached under the zone's CANONICAL name (`resolvedOptions`),
 * never under the string a request spelled it with — "aSiA/jErUsAlEm" is
 * accepted by Intl, and a caller can spell a zone thousands of ways. The
 * spelling → canonical map is bounded too, since that is the one a request
 * can grow.
 */
const formatters = new Map<string, Intl.DateTimeFormat>()
const canonicalZone = new Map<string, string>()
const MAX_ZONE_SPELLINGS = 1024

function formatterFor(timezone: string | undefined): Intl.DateTimeFormat | null {
  const spelled = timezone && timezone.trim() ? timezone.trim() : "UTC"
  const known = canonicalZone.get(spelled)
  if (known) return formatters.get(known) ?? null
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: spelled,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
    const canonical = fmt.resolvedOptions().timeZone
    if (!formatters.has(canonical)) formatters.set(canonical, fmt)
    if (canonicalZone.size >= MAX_ZONE_SPELLINGS) canonicalZone.clear()
    canonicalZone.set(spelled, canonical)
    return formatters.get(canonical) ?? fmt
  } catch {
    return null
  }
}

/** A timezone this runtime can read the clock in (an IANA name such as `Asia/Jerusalem`). */
export function isValidTimezone(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && formatterFor(value) !== null
}

/** One wall-clock minute, as a key: the same key twice means the clocks fell back. */
export function localMinuteKey(local: LocalTime): string {
  return `${local.epochDay}:${local.hour}:${local.minute}`
}

function localFromComponents(year: number, month: number, day: number, hour: number, minute: number): LocalTime {
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86400000)
  // 1970-01-01 was a Thursday (4).
  const weekday = (((epochDay % 7) + 7 + 4) % 7)
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, weekday, epochDay }
}

/** The wall-clock time in the schedule's timezone (UTC when it is missing or unknown). */
export function localTimeIn(date: Date, timezone?: string): LocalTime {
  const fmt = formatterFor(timezone)
  if (!fmt) return localFromComponents(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes())
  const parts: Record<string, number> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type === "literal") continue
    parts[p.type] = parseInt(p.value, 10)
  }
  return localFromComponents(parts.year, parts.month, parts.day, parts.hour, parts.minute)
}

/** How far the timezone's wall clock is ahead of UTC at this instant, in minutes. */
export function timezoneOffsetMinutes(date: Date, timezone?: string): number {
  const local = localTimeIn(date, timezone)
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  const truncated = Math.floor(date.getTime() / 60000) * 60000
  return Math.round((asUtc - truncated) / 60000)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Standard 5-field cron field: `*`, `N`, `a-b`, `a,b`, `*\/N`, `a-b/N`, `a/N`. */
export function matchesCronField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true
  if (field.includes(",")) return field.split(",").some((part) => matchesCronField(part.trim(), value, min, max))
  if (field.includes("/")) {
    const [range, step] = field.split("/")
    const stepNum = parseInt(step, 10)
    if (Number.isNaN(stepNum) || stepNum <= 0) return false
    if (range === "*") return value % stepNum === 0
    if (range.includes("-")) {
      const [start, end] = parseRange(range)
      if (start === null || end === null) return false
      return value >= start && value <= end && (value - start) % stepNum === 0
    }
    const start = parseInt(range, 10)
    if (Number.isNaN(start)) return false
    return value >= start && value <= max && (value - start) % stepNum === 0
  }
  if (field.includes("-")) {
    const [start, end] = parseRange(field)
    if (start === null || end === null) return false
    return value >= start && value <= end
  }
  const num = parseInt(field, 10)
  return !Number.isNaN(num) && num === value
}

function parseRange(range: string): [number | null, number | null] {
  const parts = range.split("-")
  if (parts.length !== 2) return [null, null]
  const start = parseInt(parts[0], 10)
  const end = parseInt(parts[1], 10)
  return [Number.isNaN(start) ? null : start, Number.isNaN(end) ? null : end]
}

/** Does this wall-clock minute match the cron expression? */
export function matchesCron(expression: string, local: LocalTime): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  // Every field must match (day-of-month AND day-of-week — the stricter of
  // the two readings crontabs disagree on; documented). Sunday answers to 7
  // as well as 0, as it does in every crontab.
  return (
    matchesCronField(fields[0], local.minute, 0, 59) &&
    matchesCronField(fields[1], local.hour, 0, 23) &&
    matchesCronField(fields[2], local.day, 1, 31) &&
    matchesCronField(fields[3], local.month, 1, 12) &&
    (matchesCronField(fields[4], local.weekday, 0, 6) || (local.weekday === 0 && matchesCronField(fields[4], 7, 0, 7)))
  )
}

/** Does this wall-clock minute match the rule? */
export function ruleMatches(rule: ScheduleRule, local: LocalTime): boolean {
  const every = Math.max(1, rule.every ?? 1)
  const minute = rule.minute ?? 0
  const hour = rule.hour ?? 0
  switch (rule.kind) {
    case "minutes":
      return local.minute % every === 0
    case "hours":
      return local.minute === minute && local.hour % every === 0
    case "days":
      return local.minute === minute && local.hour === hour && local.epochDay % every === 0
    case "weeks": {
      // Monday-start weeks counted from the epoch (1970-01-01 was a Thursday, so +3 lands Monday 1969-12-29 on week 0).
      const weekIndex = Math.floor((local.epochDay + 3) / 7)
      return (
        local.minute === minute &&
        local.hour === hour &&
        (rule.weekdays ?? []).includes(local.weekday) &&
        weekIndex % every === 0
      )
    }
    case "months": {
      const wanted = Math.min(rule.dayOfMonth ?? 1, daysInMonth(local.year, local.month))
      const monthIndex = local.year * 12 + (local.month - 1)
      return local.minute === minute && local.hour === hour && local.day === wanted && monthIndex % every === 0
    }
    case "cron":
      return typeof rule.cron === "string" && matchesCron(rule.cron, local)
  }
}

/** Does the schedule run at this instant (any rule, this minute)? */
export function scheduleMatchesAt(spec: ScheduleSpec, at: Date): boolean {
  if (spec.rules.length === 0) return false
  const local = localTimeIn(at, spec.timezone)
  return spec.rules.some((rule) => ruleMatches(rule, local))
}

// ---------------------------------------------------------------------------
// Occurrences (previews)
// ---------------------------------------------------------------------------

/** Clocks change on a quarter hour at the latest (Adelaide and Lord Howe move mid-UTC-hour), so the offset is re-read per 15-minute slot. */
const OFFSET_SLOT_MS = 15 * 60000

/**
 * Every minute in [from, until] at which the schedule runs, oldest first, at
 * most `cap`. Scans minute by minute with the timezone offset re-read once per
 * quarter hour, so a 62-day horizon costs ~90k cheap checks and ~6k clock
 * reads. A wall-clock minute the clocks fall back onto is listed once.
 */
export function scheduleOccurrences(spec: ScheduleSpec, from: Date, until: Date, cap: number): Date[] {
  const out: Date[] = []
  if (spec.rules.length === 0 || cap <= 0) return out
  const rules = spec.rules
  let t = Math.ceil(from.getTime() / 60000) * 60000
  const end = until.getTime()
  let slot = -1
  let offset = 0
  let lastKey = ""
  while (t <= end && out.length < cap) {
    const thisSlot = Math.floor(t / OFFSET_SLOT_MS)
    if (thisSlot !== slot) {
      slot = thisSlot
      offset = timezoneOffsetMinutes(new Date(t), spec.timezone)
    }
    const shifted = new Date(t + offset * 60000)
    const local = localFromComponents(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
    )
    if (rules.some((rule) => ruleMatches(rule, local))) {
      const key = localMinuteKey(local)
      if (key !== lastKey) out.push(new Date(t))
      lastKey = key
    }
    t += 60000
  }
  return out
}

const DAY_MS = 86400000

/**
 * How far ahead a preview must look to find the schedule's next run: two
 * periods of its slowest rule (a quarterly rule needs half a year, a yearly
 * one two), never less than two months and never more than ~two years.
 */
export function previewHorizonMs(rules: ReadonlyArray<ScheduleRule>): number {
  let longest = 0
  for (const rule of rules) {
    const every = Math.max(1, rule.every ?? 1)
    const period =
      rule.kind === "days" ? every * DAY_MS
      : rule.kind === "weeks" ? every * 7 * DAY_MS
      : rule.kind === "months" ? every * 31 * DAY_MS
      : rule.kind === "cron" ? 366 * DAY_MS
      : DAY_MS
    if (period > longest) longest = period
  }
  return Math.min(800 * DAY_MS, Math.max(62 * DAY_MS, longest * 2 + DAY_MS))
}

/**
 * The next `count` runs strictly after `from` (the minute `from` is in does
 * not count, the very next one does), looking `horizonMs` ahead — by default
 * as far as the rules need (`previewHorizonMs`).
 */
export function nextScheduleRuns(spec: ScheduleSpec, from: Date, count: number, horizonMs = previewHorizonMs(spec.rules)): Date[] {
  return scheduleOccurrences(spec, new Date(from.getTime() + 1), new Date(from.getTime() + horizonMs), count)
}

// Putting a rule into words is deliberately NOT here: the editor says it in
// the person's language (i18n), and nothing in the wire contract needs the
// English. The rule's fields are the structured form to render from.
