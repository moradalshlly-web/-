import { describe, it, expect } from "vitest"
import { translate, type TFunction } from "@/lib/i18n"
import {
  clockLabel,
  describeNextRun,
  describeSchedule,
  describeScheduleRule,
  relativeFromNow,
  ruleCountLabel,
  runsPerDayLabel,
  weekdayShort,
} from "../schedule-words"

const en: TFunction = (key, vars) => translate("en", key, vars)
const he: TFunction = (key, vars) => translate("he", key, vars)
const HEBREW = /[֐-׿]/
const at = (iso: string) => new Date(iso)

describe("describeScheduleRule — a rule in words", () => {
  it("says each kind in English, with the clock in the locale's own style", () => {
    expect(describeScheduleRule({ id: "a", kind: "minutes", every: 1 }, en, "en")).toBe("Every minute")
    expect(describeScheduleRule({ id: "a", kind: "minutes", every: 20 }, en, "en")).toBe("Every 20 minutes")
    expect(describeScheduleRule({ id: "a", kind: "hours", every: 1, minute: 5 }, en, "en")).toBe("Every hour at :05")
    expect(describeScheduleRule({ id: "a", kind: "hours", every: 6, minute: 30 }, en, "en")).toBe("Every 6 hours at :30")
    expect(describeScheduleRule({ id: "a", kind: "days", every: 1, hour: 9, minute: 0 }, en, "en")).toMatch(/^Every day at 9:00\s?AM$/)
    expect(describeScheduleRule({ id: "a", kind: "days", every: 3, hour: 18, minute: 30 }, en, "en")).toMatch(/^Every 3 days at 6:30\s?PM$/)
    expect(describeScheduleRule({ id: "a", kind: "weeks", every: 1, hour: 9, minute: 0, weekdays: [1, 3] }, en, "en")).toMatch(/^Every week on Mon, Wed at 9:00\s?AM$/)
    expect(describeScheduleRule({ id: "a", kind: "weeks", every: 2, hour: 9, minute: 0, weekdays: [5] }, en, "en")).toMatch(/^Every 2 weeks on Fri at 9:00\s?AM$/)
    expect(describeScheduleRule({ id: "a", kind: "months", every: 1, hour: 0, minute: 0, dayOfMonth: 15 }, en, "en")).toMatch(/^Every month on day 15 at 12:00\s?AM$/)
    expect(describeScheduleRule({ id: "a", kind: "months", every: 3, hour: 8, minute: 0, dayOfMonth: 1 }, en, "en")).toMatch(/^Every 3 months on day 1 at 8:00\s?AM$/)
    expect(describeScheduleRule({ id: "a", kind: "cron", cron: "0 9 * * 1-5" }, en, "en")).toBe("Custom schedule")
  })

  it("says the same rules in Hebrew — real Hebrew, with the numbers in place", () => {
    const twenty = describeScheduleRule({ id: "a", kind: "minutes", every: 20 }, he, "he")
    expect(twenty).toMatch(HEBREW)
    expect(twenty).toContain("20")
    const weekly = describeScheduleRule({ id: "a", kind: "weeks", every: 1, hour: 9, minute: 0, weekdays: [0] }, he, "he")
    expect(weekly).toMatch(HEBREW)
    expect(weekly).toContain(weekdayShort(0, "he"))
  })

  it("the whole schedule: one rule's words, or a count", () => {
    expect(describeSchedule([], en, "en")).toBe("No schedule yet")
    expect(describeSchedule([{ id: "a", kind: "minutes", every: 5 }], en, "en")).toBe("Every 5 minutes")
    expect(describeSchedule([{ id: "a", kind: "minutes", every: 5 }, { id: "b", kind: "days" }], en, "en")).toBe("2 schedules")
  })
})

describe("clock and calendar words follow the locale", () => {
  it("clockLabel and weekdayShort", () => {
    expect(clockLabel(9, 5, "en")).toMatch(/^9:05\s?AM$/)
    expect(clockLabel(9, 5, "he")).toMatch(/9:05/)
    expect(weekdayShort(1, "en")).toBe("Mon")
    expect(weekdayShort(0, "en")).toBe("Sun")
  })

  it("describeNextRun says 'today' in the schedule's timezone, otherwise the date", () => {
    const now = at("2026-07-01T06:30:00Z") // 09:30 in Jerusalem
    expect(describeNextRun(at("2026-07-01T14:35:00Z"), now, "Asia/Jerusalem", "en", en)).toMatch(/^Next run today at 5:35\s?PM$/)
    // 23:30Z is already July 2nd in Jerusalem.
    expect(describeNextRun(at("2026-07-01T23:30:00Z"), now, "Asia/Jerusalem", "en", en)).toMatch(/^Next run .*Jul 2 at 2:30\s?AM$/)
    expect(describeNextRun(null, now, "UTC", "en", en)).toBe("No run in the next year")
  })

  it("relativeFromNow rounds DOWN to the unit — 90 minutes is 'in 1 hour', 36 hours 'in 1 day'", () => {
    const now = at("2026-07-01T06:30:00Z")
    expect(relativeFromNow(at("2026-07-01T06:50:00Z"), now, "en", en)).toBe("in 20 minutes")
    expect(relativeFromNow(at("2026-07-01T08:00:00Z"), now, "en", en)).toBe("in 1 hour")
    expect(relativeFromNow(at("2026-07-01T09:30:00Z"), now, "en", en)).toBe("in 3 hours")
    expect(relativeFromNow(at("2026-07-02T18:30:00Z"), now, "en", en)).toBe("in 1 day")
    expect(relativeFromNow(at("2026-07-03T06:30:00Z"), now, "en", en)).toBe("in 2 days")
    expect(relativeFromNow(at("2026-07-01T06:30:20Z"), now, "en", en)).toBe("in under a minute")
  })

  it("counts", () => {
    expect(runsPerDayLabel(1, en)).toBe("1 run per day")
    expect(runsPerDayLabel(72, en)).toBe("72 runs per day")
    expect(ruleCountLabel(1, en)).toBe("1 rule")
    expect(ruleCountLabel(3, en)).toBe("3 rules")
  })
})
