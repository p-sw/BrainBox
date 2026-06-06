export const extractedFactSchema = {
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
          required: ["name", "category", "granularity", "role", "description"],
        },
      },
    },
    required: ["statement", "summary", "source", "confidence", "topics"],
  },
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
};

export const availabilitySchema = {
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      start: timeString,
      end: endTimeString,
      status: { type: "string", enum: ["online", "do-not-disturb", "offline"] },
    },
    required: ["start", "end", "status"],
  },
};
