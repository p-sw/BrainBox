import { llm } from "@/openrouter";
import { extractedFactSchema, type ExtractedFactResult } from "@/openrouter/schema";
import { type ExtractedFact, LlmFactExtractor } from "identitydb";

export const factExtractor = new LlmFactExtractor({
  model: {
    async generateText({ instruction, input }) {
      const result = await llm.call<ExtractedFactResult>(llm.models.identity, {
        instruction,
        message: input,
        jsonSchemaName: "fact-extractor",
        jsonSchema: extractedFactSchema,
      });
      return result.items;
    },
  },
});
