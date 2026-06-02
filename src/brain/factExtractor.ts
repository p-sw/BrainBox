import { llm } from "@/openrouter";
import { extractedFactSchema } from "@/openrouter/schema";
import { type ExtractedFact, LlmFactExtractor } from "identitydb";

export const factExtractor = new LlmFactExtractor({
  model: {
    async generateText({ instruction, input }) {
      return await llm.call<ExtractedFact[]>(llm.models.identity, {
        instruction,
        message: input,
        jsonSchemaName: "fact-extractor",
        jsonSchema: extractedFactSchema,
      });
    },
  },
});
