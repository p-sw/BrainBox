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

export type DailySlot = {
  start: string;
  end: string;
  activity: string;
  notes: string;
};

export type DailySchedule = {
  items: DailySlot[];
};

export type MonthlyDay = {
  day: number;
  summary: string;
};

export type MonthlySchedule = {
  items: MonthlyDay[];
};

export type AvailabilityStatus = "online" | "do-not-disturb" | "offline";

export type Availability = {
  start: string;
  end: string;
  status: AvailabilityStatus;
};

export type AvailabilityWindows = {
  items: Availability[];
};

export const baseSystemPromptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    baseSystemPrompt: { type: "string" },
    dndReplyProbability: { type: "number", minimum: 0, maximum: 1 },
    startConversationCountThreshold: {
      type: "integer",
      minimum: 0,
      maximum: 10,
    },
    startConversationTimeThreshold: {
      type: "integer",
      minimum: 30,
      maximum: 720,
    },
  },
  required: [
    "baseSystemPrompt",
    "dndReplyProbability",
    "startConversationCountThreshold",
    "startConversationTimeThreshold",
  ],
};

export type BaseSystemPromptGeneration = {
  baseSystemPrompt: string;
  dndReplyProbability: number;
  startConversationCountThreshold: number;
  startConversationTimeThreshold: number;
};
