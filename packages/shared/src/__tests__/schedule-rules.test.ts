import { describe, it, expect } from "vitest"
import {
  isValidTimezone,
  legacyScheduleToRules,
  localMinuteKey,
  localTimeIn,
  nextScheduleRuns,
  normalizeScheduleRule,
  normalizeScheduleRules,
  previewHorizonMs,
  ruleMatches,
  scheduleMatchesAt,
  scheduleOccurrences,
  timezoneOffsetMinutes,
  type ScheduleRule,
} from "../schedule-rules.js"

const at = (iso: string) => new Date(iso)

describe("normalizeScheduleRule", () => {
  it("clamps to the kind's range instead of refusing, and fills the defaults", () => {
    // 0 is "not typed yet": the kind's default, never every minute.
    expect(normalizeScheduleRule({ id: "a", kind: "minutes", every: 0 })).toEqual({ id: "a", kind: "minutes", every: 5 })
    expect(normalizeScheduleRule({ id: "a", kind: "minutes", every: "120" })).toEqual({ id: "a", kind: "minutes", every: 59 })
    expect(normalizeScheduleRule({ id: "a", kind: "hours", every: 2, minute: 75 })).toEqual({ id: "a", kind: "hours", every: 2, minute: 59 })
    expect(normalizeScheduleRule({ kind: "days" }, "rule-7")).toEqual({ id: "rule-7", kind: "days", every: 1, hour: 0, minute: 0 })
    expect(normalizeScheduleRule({ id: "m", kind: "months", every: 3, dayOfMonth: 40, hour: 9 })).toEqual({ id: "m", kind: "months", every: 3, hour: 9, minute: 0, dayOfMonth: 31 })
  })

  it("weeks keeps only valid weekdays, deduplicated and sorted; none means no rule", () => {
    expect(normalizeScheduleRule({ id: "w", kind: "weeks", weekdays: [5, 1, 1, 9, -1, "3"], hour: 9 })).toEqual({ id: "w", kind: "weeks", every: 1, hour: 9, minute: 0, weekdays: [1, 3, 5] })
    expect(normalizeScheduleRule({ id: "w", kind: "weeks", weekdays: [] })).toBeNull()
  })

  it("a cron rule needs a 5-field expression; unknown kinds are not rules", () => {
    expect(normalizeScheduleRule({ id: "c", kind: "cron", cron: "  0  9   * * 1-5 " })).toEqual({ id: "c", kind: "cron", cron: "0 9 * * 1-5" })
    expect(normalizeScheduleRule({ id: "c", kind: "cron", cron: "0 9 * *" })).toBeNull()
    expect(normalizeScheduleRule({ id: "s", kind: "seconds", every: 30 })).toBeNull()
    expect(normalizeScheduleRules([{ kind: "minutes", every: 5 }, { kind: "nope" }, null])).toHaveLength(1)
  })
})

describe("legacyScheduleToRules — the old node fields as rules", () => {
  it("interval strings", () => {
    expect(legacyScheduleToRules({ interval: "5m" })).toEqual([{ id: "rule-1", kind: "minutes", every: 5 }])
    expect(legacyScheduleToRules({ interval: "90m" })).toEqual([{ id: "rule-1", kind: "hours", every: 2, minute: 0 }])
    expect(legacyScheduleToRules({ interval: "1h" })).toEqual([{ id: "rule-1", kind: "hours", every: 1, minute: 0 }])
    expect(legacyScheduleToRules({ interval: "2d" })).toEqual([{ id: "rule-1", kind: "days", every: 2, hour: 0, minute: 0 }])
    // Seconds cannot be scheduled: the cron ticks once a minute.
    expect(legacyScheduleToRules({ interval: "30s" })).toEqual([{ id: "rule-1", kind: "minutes", every: 1 }])
  })

  it("the editor's cron presets become words, a custom cron stays a cron rule", () => {
    expect(legacyScheduleToRules({ interval: "*/15 * * * *" })).toEqual([{ id: "rule-1", kind: "minutes", every: 15 }])
    expect(legacyScheduleToRules({ interval: "0 * * * *" })).toEqual([{ id: "rule-1", kind: "hours", every: 1, minute: 0 }])
    expect(legacyScheduleToRules({ interval: "0 0 * * *" })).toEqual([{ id: "rule-1", kind: "days", every: 1, hour: 0, minute: 0 }])
    expect(legacyScheduleToRules({ interval: "custom", cron: "30 9 * * 1-5" })).toEqual([{ id: "rule-1", kind: "weeks", every: 1, hour: 9, minute: 30, weekdays: [1, 2, 3, 4, 5] }])
    expect(legacyScheduleToRules({ interval: "custom", cronExpression: "0 6 1 * *" })).toEqual([{ id: "rule-1", kind: "months", every: 1, hour: 6, minute: 0, dayOfMonth: 1 }])
    expect(legacyScheduleToRules({ interval: "custom", cron: "0 6 * 3 *" })).toEqual([{ id: "rule-1", kind: "cron", cron: "0 6 * 3 *" }])
    expect(legacyScheduleToRules({})).toEqual([])
    expect(legacyScheduleToRules({ interval: "custom", cron: "not cron" })).toEqual([])
  })
})

describe("localTimeIn / timezoneOffsetMinutes", () => {
  it("reads the wall clock in the schedule's timezone; unknown zones mean UTC", () => {
    const summer = at("2026-07-01T06:30:00Z")
    expect(localTimeIn(summer, "Asia/Jerusalem")).toMatchObject({ year: 2026, month: 7, day: 1, hour: 9, minute: 30, weekday: 3 })
    expect(localTimeIn(summer, "America/New_York")).toMatchObject({ hour: 2, minute: 30 })
    expect(localTimeIn(summer, "Not/AZone")).toMatchObject({ hour: 6, minute: 30 })
    expect(localTimeIn(summer)).toMatchObject({ hour: 6, minute: 30 })
    expect(timezoneOffsetMinutes(summer, "Asia/Jerusalem")).toBe(180)
    expect(timezoneOffsetMinutes(at("2026-01-15T12:00:00Z"), "Asia/Jerusalem")).toBe(120)
  })

  it("isValidTimezone knows the zones this runtime can read", () => {
    expect(isValidTimezone("Asia/Jerusalem")).toBe(true)
    expect(isValidTimezone("UTC")).toBe(true)
    expect(isValidTimezone("Not/AZone")).toBe(false)
    expect(isValidTimezone("")).toBe(false)
    expect(isValidTimezone(undefined)).toBe(false)
  })

  it("localMinuteKey names one wall-clock minute", () => {
    expect(localMinuteKey(localTimeIn(at("2026-09-22T10:05:30Z")))).toBe(localMinuteKey(localTimeIn(at("2026-09-22T10:05:59Z"))))
    expect(localMinuteKey(localTimeIn(at("2026-09-22T10:05:00Z")))).not.toBe(localMinuteKey(localTimeIn(at("2026-09-22T10:06:00Z"))))
  })

  it("epochDay and weekday agree with the calendar", () => {
    expect(localTimeIn(at("1970-01-01T12:00:00Z"))).toMatchObject({ epochDay: 0, weekday: 4 })
    expect(localTimeIn(at("2026-09-21T12:00:00Z"))).toMatchObject({ weekday: 1 }) // a Monday
  })
})

describe("ruleMatches — one minute against one rule", () => {
  const local = (iso: string, tz?: string) => localTimeIn(at(iso), tz)

  it("minutes: at 0, N, 2N… of every hour", () => {
    const rule: ScheduleRule = { id: "r", kind: "minutes", every: 20 }
    expect(ruleMatches(rule, local("2026-09-22T10:00:00Z"))).toBe(true)
    expect(ruleMatches(rule, local("2026-09-22T10:20:00Z"))).toBe(true)
    expect(ruleMatches(rule, local("2026-09-22T10:21:00Z"))).toBe(false)
  })

  it("hours: every Nth hour at the given minute", () => {
    const rule: ScheduleRule = { id: "r", kind: "hours", every: 6, minute: 15 }
    expect(ruleMatches(rule, local("2026-09-22T06:15:00Z"))).toBe(true)
    expect(ruleMatches(rule, local("2026-09-22T07:15:00Z"))).toBe(false)
    expect(ruleMatches(rule, local("2026-09-22T06:16:00Z"))).toBe(false)
  })

  it("days: at hour:minute in the schedule's timezone, every Nth day from a fixed origin", () => {
    const daily: ScheduleRule = { id: "r", kind: "days", every: 1, hour: 9, minute: 0 }
    expect(ruleMatches(daily, local("2026-07-01T06:00:00Z", "Asia/Jerusalem"))).toBe(true) // 09:00 in Jerusalem (summer)
    expect(ruleMatches(daily, local("2026-07-01T09:00:00Z", "Asia/Jerusalem"))).toBe(false)
    const everyThird: ScheduleRule = { id: "r", kind: "days", every: 3, hour: 0, minute: 0 }
    const hits = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((d) => ruleMatches(everyThird, local(`2026-09-${String(10 + d).padStart(2, "0")}T00:00:00Z`)))
    expect(hits).toHaveLength(3) // any nine consecutive days hold exactly three "every third day" hits
    expect(hits[1] - hits[0]).toBe(3)
    expect(hits[2] - hits[1]).toBe(3)
  })

  it("weeks: on the chosen weekdays; every Nth Monday-start week", () => {
    const weekdays9: ScheduleRule = { id: "r", kind: "weeks", every: 1, hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] }
    expect(ruleMatches(weekdays9, local("2026-09-21T09:00:00Z"))).toBe(true) // Monday
    expect(ruleMatches(weekdays9, local("2026-09-20T09:00:00Z"))).toBe(false) // Sunday
    const biweekly: ScheduleRule = { id: "r", kind: "weeks", every: 2, hour: 9, minute: 0, weekdays: [1] }
    const mondays = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((d) => ruleMatches(biweekly, local(`${d}T09:00:00Z`)))
    expect(mondays.filter(Boolean)).toHaveLength(2)
    expect(mondays[0]).toBe(mondays[2]) // alternating, phase stable
  })

  it("months: on the day of month (clamped to the month's length) at hour:minute", () => {
    const the31st: ScheduleRule = { id: "r", kind: "months", every: 1, hour: 8, minute: 0, dayOfMonth: 31 }
    expect(ruleMatches(the31st, local("2026-01-31T08:00:00Z"))).toBe(true)
    expect(ruleMatches(the31st, local("2026-02-28T08:00:00Z"))).toBe(true) // February has no 31st
    expect(ruleMatches(the31st, local("2026-02-27T08:00:00Z"))).toBe(false)
    const quarterly: ScheduleRule = { id: "r", kind: "months", every: 3, hour: 0, minute: 0, dayOfMonth: 1 }
    const firsts = [1, 2, 3, 4, 5, 6].map((m) => ruleMatches(quarterly, local(`2026-${String(m).padStart(2, "0")}-01T00:00:00Z`)))
    expect(firsts.filter(Boolean)).toHaveLength(2)
  })

  it("cron: a 5-field expression, weekday 0 = Sunday", () => {
    const rule: ScheduleRule = { id: "r", kind: "cron", cron: "30 6 * * 1-5" }
    expect(ruleMatches(rule, local("2026-09-21T06:30:00Z"))).toBe(true)
    expect(ruleMatches(rule, local("2026-09-20T06:30:00Z"))).toBe(false)
    expect(ruleMatches({ id: "r", kind: "cron", cron: "*/15 * * * *" }, local("2026-09-21T06:45:00Z"))).toBe(true)
  })
})

describe("scheduleMatchesAt / scheduleOccurrences / nextScheduleRuns", () => {
  it("any rule matching this minute fires the schedule", () => {
    const spec = { rules: [{ id: "a", kind: "hours" as const, every: 1, minute: 0 }, { id: "b", kind: "minutes" as const, every: 20 }] }
    expect(scheduleMatchesAt(spec, at("2026-09-22T10:40:00Z"))).toBe(true)
    expect(scheduleMatchesAt(spec, at("2026-09-22T10:41:00Z"))).toBe(false)
    expect(scheduleMatchesAt({ rules: [] }, at("2026-09-22T10:00:00Z"))).toBe(false)
  })

  it("every 20 minutes is 72 runs a day; several rules merge into one chronological list", () => {
    const day = { from: at("2026-09-22T00:00:00Z"), until: at("2026-09-22T23:59:00Z") }
    expect(scheduleOccurrences({ rules: [{ id: "a", kind: "minutes", every: 20 }] }, day.from, day.until, 5000)).toHaveLength(72)
    const two = scheduleOccurrences(
      { rules: [{ id: "a", kind: "hours", every: 12, minute: 0 }, { id: "b", kind: "days", every: 1, hour: 6, minute: 0 }] },
      day.from, day.until, 10,
    )
    expect(two.map((d) => d.toISOString())).toEqual(["2026-09-22T00:00:00.000Z", "2026-09-22T06:00:00.000Z", "2026-09-22T12:00:00.000Z"])
  })

  it("the next runs respect the timezone across a DST change", () => {
    // New York springs forward on 2026-03-08 at 02:00. A daily 09:00 rule stays at 09:00 local: 14:00Z before, 13:00Z after.
    const spec = { rules: [{ id: "a", kind: "days" as const, every: 1, hour: 9, minute: 0 }], timezone: "America/New_York" }
    const runs = nextScheduleRuns(spec, at("2026-03-07T00:00:00Z"), 2)
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z"])
  })

  it("a zone whose clocks change mid-UTC-hour keeps its wall-clock time across the change", () => {
    // Adelaide springs forward on 2026-10-04 at 02:00 (+9:30 → +10:30), which is 16:30Z.
    // A daily 03:15 rule: 17:45Z before the change, 16:45Z from the day of the change.
    const spec = { rules: [{ id: "a", kind: "days" as const, every: 1, hour: 3, minute: 15 }], timezone: "Australia/Adelaide" }
    expect(nextScheduleRuns(spec, at("2026-10-02T00:00:00Z"), 3).map((d) => d.toISOString())).toEqual([
      "2026-10-02T17:45:00.000Z",
      "2026-10-03T16:45:00.000Z",
      "2026-10-04T16:45:00.000Z",
    ])
  })

  it("a wall-clock minute the clocks fall back onto runs once; one they jump over is skipped that day", () => {
    // New York falls back on 2026-11-01 at 02:00 EDT → 01:00 EST: 01:30 local happens at 05:30Z and again at 06:30Z.
    const fallBack = { rules: [{ id: "a", kind: "days" as const, every: 1, hour: 1, minute: 30 }], timezone: "America/New_York" }
    expect(scheduleOccurrences(fallBack, at("2026-11-01T00:00:00Z"), at("2026-11-01T12:00:00Z"), 5).map((d) => d.toISOString()))
      .toEqual(["2026-11-01T05:30:00.000Z"])
    // Springs forward on 2026-03-08 at 02:00 → 03:00: 02:30 local does not exist that day.
    const springForward = { rules: [{ id: "a", kind: "days" as const, every: 1, hour: 2, minute: 30 }], timezone: "America/New_York" }
    expect(scheduleOccurrences(springForward, at("2026-03-08T00:00:00Z"), at("2026-03-08T23:59:00Z"), 5)).toEqual([])
    expect(scheduleOccurrences(springForward, at("2026-03-09T00:00:00Z"), at("2026-03-09T23:59:00Z"), 5).map((d) => d.toISOString()))
      .toEqual(["2026-03-09T06:30:00.000Z"])
  })

  it("the next run of a weekly rule is the next chosen weekday", () => {
    const spec = { rules: [{ id: "a", kind: "weeks" as const, every: 1, hour: 9, minute: 0, weekdays: [1] }] }
    expect(nextScheduleRuns(spec, at("2026-09-22T12:00:00Z"), 1).map((d) => d.toISOString())).toEqual(["2026-09-28T09:00:00.000Z"])
  })
})

describe("the edges a review found", () => {
  const iso = (d: Date) => d.toISOString()

  it("weeks are Monday-start: a Sunday and the Monday after it fall in different weeks", () => {
    const rule: ScheduleRule = { id: "r", kind: "weeks", every: 2, hour: 9, minute: 0, weekdays: [0, 1] }
    const sunday = ruleMatches(rule, localTimeIn(at("2026-09-20T09:00:00Z")))
    const monday = ruleMatches(rule, localTimeIn(at("2026-09-21T09:00:00Z")))
    expect(sunday).not.toBe(monday)
  })

  it("a quarterly rule lands on January, April, July and October — by value, not by count", () => {
    const quarterly: ScheduleRule = { id: "r", kind: "months", every: 3, hour: 0, minute: 0, dayOfMonth: 1 }
    const months = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) =>
      ruleMatches(quarterly, localTimeIn(at(`2026-${String(m).padStart(2, "0")}-01T00:00:00Z`))),
    )
    expect(months).toEqual([1, 4, 7, 10])
  })

  it("a legacy cron nobody could say in words never becomes 'every minute', and an empty weekday set is no rule", () => {
    // "*/0" never matched before (a zero step); it stays a cron rule that never matches.
    const zeroStep = legacyScheduleToRules({ interval: "custom", cron: "*/0 * * * *" })
    expect(zeroStep).toEqual([{ id: "rule-1", kind: "cron", cron: "*/0 * * * *" }])
    expect(scheduleMatchesAt({ rules: zeroStep }, at("2026-09-22T10:00:00Z"))).toBe(false)
    expect(legacyScheduleToRules({ interval: "custom", cron: "0 9 * * 5-0" })).toEqual([])
    // "0m" parsed to 0 ms and never fired; it is not a schedule now either.
    expect(legacyScheduleToRules({ interval: "0m" })).toEqual([])
  })

  it("every: 0 is 'not typed yet' — the kind's default, never every minute", () => {
    expect(normalizeScheduleRule({ id: "a", kind: "minutes", every: 0 })).toEqual({ id: "a", kind: "minutes", every: 5 })
    expect(normalizeScheduleRule({ id: "a", kind: "hours", every: -2 })).toEqual({ id: "a", kind: "hours", every: 1, minute: 0 })
  })

  it("the next run is the very next minute, even when asked mid-minute", () => {
    expect(nextScheduleRuns({ rules: [{ id: "a", kind: "minutes", every: 1 }] }, at("2026-09-22T12:00:30Z"), 2).map(iso))
      .toEqual(["2026-09-22T12:01:00.000Z", "2026-09-22T12:02:00.000Z"])
    expect(nextScheduleRuns({ rules: [{ id: "a", kind: "days", every: 1, hour: 12, minute: 1 }] }, at("2026-09-22T12:00:30Z"), 1).map(iso))
      .toEqual(["2026-09-22T12:01:00.000Z"])
  })

  it("a quarterly or yearly rule still gets its next run — the horizon follows the rules", () => {
    const yearly = { rules: [{ id: "a", kind: "months" as const, every: 12, hour: 9, minute: 0, dayOfMonth: 1 }] }
    expect(nextScheduleRuns(yearly, at("2026-02-02T00:00:00Z"), 1).map(iso)).toEqual(["2027-01-01T09:00:00.000Z"])
    const quarterly = { rules: [{ id: "a", kind: "months" as const, every: 3, hour: 9, minute: 0, dayOfMonth: 1 }] }
    expect(nextScheduleRuns(quarterly, at("2026-01-02T00:00:00Z"), 1).map(iso)).toEqual(["2026-04-01T09:00:00.000Z"])
    expect(previewHorizonMs([{ id: "a", kind: "minutes", every: 5 }])).toBe(62 * 86400000)
    expect(previewHorizonMs(yearly.rules)).toBeGreaterThan(365 * 86400000)
  })

  it("Sunday answers to 7 in a cron rule, as in every crontab", () => {
    const sundayAsSeven: ScheduleRule = { id: "r", kind: "cron", cron: "0 9 * * 7" }
    expect(ruleMatches(sundayAsSeven, localTimeIn(at("2026-09-20T09:00:00Z")))).toBe(true) // a Sunday
    expect(ruleMatches(sundayAsSeven, localTimeIn(at("2026-09-21T09:00:00Z")))).toBe(false)
  })

  it("a timezone is read the same however it is spelled, and cached under its canonical name", () => {
    expect(isValidTimezone("aSiA/jErUsAlEm")).toBe(true)
    expect(localTimeIn(at("2026-07-01T06:30:00Z"), "aSiA/jErUsAlEm").hour).toBe(9)
  })
})

