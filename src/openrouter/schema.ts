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
