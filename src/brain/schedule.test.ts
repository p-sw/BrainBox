import { describe, expect, test } from "bun:test";
import {
  formatDateKey,
  formatMonthKey,
  nextDay,
  nextMonth,
  pad2,
} from "./schedule";

describe("pad2", () => {
  test("zero-pads single digit", () => {
    expect(pad2(0)).toBe("00");
    expect(pad2(1)).toBe("01");
    expect(pad2(9)).toBe("09");
  });
  test("does not pad two digits", () => {
    expect(pad2(10)).toBe("10");
    expect(pad2(31)).toBe("31");
    expect(pad2(99)).toBe("99");
  });
});

describe("formatDateKey", () => {
  test("formats YYYY-MM-DD with zero padding", () => {
    expect(formatDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(formatDateKey(new Date(2026, 5, 30))).toBe("2026-06-30");
  });
  test("handles months 1-9 with zero padding", () => {
    expect(formatDateKey(new Date(2026, 8, 9))).toBe("2026-09-09");
  });
});

describe("formatMonthKey", () => {
  test("formats YYYY-MM with zero padding", () => {
    expect(formatMonthKey(new Date(2026, 0, 1))).toBe("2026-01");
    expect(formatMonthKey(new Date(2026, 11, 15))).toBe("2026-12");
  });
  test("handles month 9 with zero padding", () => {
    expect(formatMonthKey(new Date(2026, 8, 30))).toBe("2026-09");
  });
});

describe("nextDay", () => {
  test("returns next day within the same month", () => {
    const d = new Date(2026, 5, 5);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(5);
    expect(n.getDate()).toBe(6);
  });
  test("wraps month on last day", () => {
    const d = new Date(2026, 5, 30);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(6);
    expect(n.getDate()).toBe(1);
  });
  test("wraps year on December 31", () => {
    const d = new Date(2026, 11, 31);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2027);
    expect(n.getMonth()).toBe(0);
    expect(n.getDate()).toBe(1);
  });
  test("DST-safe: returns midnight in local time after US spring-forward", () => {
    // US DST 2026 starts March 8, 2026
    const d = new Date(2026, 2, 8);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(2);
    expect(n.getDate()).toBe(9);
    expect(n.getHours()).toBe(0);
    expect(n.getMinutes()).toBe(0);
  });
  test("DST-safe: returns midnight in local time after US fall-back", () => {
    // US DST 2026 ends November 1, 2026
    const d = new Date(2026, 10, 1);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(10);
    expect(n.getDate()).toBe(2);
    expect(n.getHours()).toBe(0);
    expect(n.getMinutes()).toBe(0);
  });
  test("handles February in leap year", () => {
    const d = new Date(2024, 1, 28);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2024);
    expect(n.getMonth()).toBe(1);
    expect(n.getDate()).toBe(29);
  });
  test("handles February in non-leap year", () => {
    const d = new Date(2026, 1, 28);
    const n = nextDay(d);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(2);
    expect(n.getDate()).toBe(1);
  });
  test("does not mutate input date", () => {
    const d = new Date(2026, 5, 15);
    const originalTime = d.getTime();
    nextDay(d);
    expect(d.getTime()).toBe(originalTime);
  });
});

describe("nextMonth", () => {
  test("returns next month within the same year", () => {
    const r = nextMonth(new Date(2026, 0, 15));
    expect(r.year).toBe(2026);
    expect(r.month).toBe(1);
    expect(r.daysInMonth).toBe(28);
  });
  test("returns daysInMonth for 30-day months", () => {
    expect(nextMonth(new Date(2026, 2, 15)).daysInMonth).toBe(30); // April
    expect(nextMonth(new Date(2026, 3, 15)).daysInMonth).toBe(31); // May
  });
  test("returns 29 for February in a leap year", () => {
    const r = nextMonth(new Date(2024, 0, 15));
    expect(r.year).toBe(2024);
    expect(r.month).toBe(1);
    expect(r.daysInMonth).toBe(29);
  });
  test("returns 28 for February in a non-leap year", () => {
    const r = nextMonth(new Date(2026, 0, 15));
    expect(r.year).toBe(2026);
    expect(r.month).toBe(1);
    expect(r.daysInMonth).toBe(28);
  });
  test("returns 31 for January", () => {
    const r = nextMonth(new Date(2025, 11, 15));
    expect(r.year).toBe(2026);
    expect(r.month).toBe(0);
    expect(r.daysInMonth).toBe(31);
  });
  test("wraps year on December 15", () => {
    const r = nextMonth(new Date(2026, 11, 15));
    expect(r.year).toBe(2027);
    expect(r.month).toBe(0);
    expect(r.daysInMonth).toBe(31);
  });
  test("month is zero-indexed (0 = January)", () => {
    const r = nextMonth(new Date(2026, 6, 15));
    expect(r.month).toBe(7);
  });
});
