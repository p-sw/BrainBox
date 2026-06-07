export const extractedFactSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          statement: { type: "string" },
          summary: { type: "string" },
          source: { type: "string" },
          confidence: { type: "number" },
          metadata: { type: "object", additionalProperties: false },
          topics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                category: {
                  type: "string",
                  enum: ["entity", "concept", "temporal", "custom"],
                },
                granularity: {
                  type: "string",
                  enum: ["abstract", "concrete", "mixed"],
                },
                role: { type: "string" },
                description: { type: "string" },
                metadata: { type: "object", additionalProperties: false },
              },
              required: [
                "name",
                "category",
                "granularity",
                "role",
                "description",
              ],
            },
          },
        },
        required: ["statement", "summary", "source", "confidence", "topics"],
      },
    },
  },
  required: ["items"],
};

const timeString = {
  type: "string",
  pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
};
const endTimeString = {
  type: "string",
  pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$",
};

export const dailyScheduleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 48,
      maxItems: 48,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: timeString,
          end: endTimeString,
          activity: { type: "string" },
          notes: { type: "string" },
        },
        required: ["start", "end", "activity", "notes"],
      },
    },
  },
  required: ["items"],
};

export const monthlyScheduleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 28,
      maxItems: 31,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "integer", minimum: 1, maximum: 31 },
          summary: { type: "string" },
        },
        required: ["day", "summary"],
      },
    },
  },
  required: ["items"],
};

export const availabilitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          start: timeString,
          end: endTimeString,
          status: {
            type: "string",
            enum: ["online", "do-not-disturb", "offline"],
          },
        },
        required: ["start", "end", "status"],
      },
    },
  },
  required: ["items"],
};

// ----------------------------------------------------------------------------
// Types — co-located with their schemas.
// ----------------------------------------------------------------------------

import type { ExtractedFact } from "identitydb";

/** A single 30-minute slot in a daily schedule. Matches `dailyScheduleSchema.items.items`. */
export type DailySlot = {
  start: string;
  end: string;
  activity: string;
  notes: string;
};

/**
 * A complete daily schedule: a wrapped object containing exactly 48 half-hour
 * slots. Matches `dailyScheduleSchema` (the LLM is constrained to return the
 * `{ items: [...] }` envelope).
 */
export type DailySchedule = {
  items: DailySlot[];
};

/** A single day's summary inside a monthly schedule. Matches `monthlyScheduleSchema.items.items`. */
export type MonthlyDay = {
  day: number;
  summary: string;
};

/**
 * A complete monthly schedule: a wrapped object containing one entry per day
 * of the month. Matches `monthlyScheduleSchema`.
 */
export type MonthlySchedule = {
  items: MonthlyDay[];
};

/** Reachability status for a single availability window. */
export type AvailabilityStatus = "online" | "do-not-disturb" | "offline";

/** A single availability window. Matches `availabilitySchema.items.items`. */
export type Availability = {
  start: string;
  end: string;
  status: AvailabilityStatus;
};

/**
 * The full set of availability windows for a day: a wrapped object containing
 * one or more windows. Matches `availabilitySchema`.
 */
export type AvailabilityWindows = {
  items: Availability[];
};

/**
 * The wrapped envelope the LLM returns for `extractedFactSchema`. The inner
 * `items` array is the list of `ExtractedFact` (which is defined in the
 * external `identitydb` package).
 */
export type ExtractedFactResult = {
  items: ExtractedFact[];
};
