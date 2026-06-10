import { config } from "@/config";
import { OpenRouter } from "@openrouter/sdk";
import type { EmbeddingProvider } from "identitydb";

export const QWEN_EMBEDDING_MODEL = "qwen/qwen3-embedding-8b" as const;
export const QWEN_EMBEDDING_DIMENSIONS = 512 as const;

export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly model: string = QWEN_EMBEDDING_MODEL;
  readonly dimensions: number = QWEN_EMBEDDING_DIMENSIONS;

  private client: OpenRouter;

  constructor(apiKey: string = config.openrouterApiKey) {
    this.client = new OpenRouter({ apiKey, appTitle: "boxbrain" });
  }

  async embed(input: string): Promise<number[]> {
    const result = await this.embedBatch([input]);
    return result[0]!;
  }

  async embedMany(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    return await this.embedBatch(inputs);
  }

  private async embedBatch(inputs: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.generate({
      requestBody: {
        model: this.model,
        input: inputs,
        dimensions: this.dimensions,
        encodingFormat: "float",
      },
    });
    if (typeof response === "string") {
      throw new Error("OpenRouter returned a non-JSON embeddings response");
    }
    const ordered = new Array<number[]>(inputs.length);
    for (const item of response.data) {
      if (typeof item.embedding === "string") {
        throw new Error(
          "OpenRouter returned a base64 embedding but float was requested",
        );
      }
      const index = item.index ?? 0;
      ordered[index] = item.embedding;
    }
    for (let i = 0; i < ordered.length; i += 1) {
      if (!ordered[i]) {
        throw new Error(`OpenRouter omitted embedding for input index ${i}`);
      }
    }
    return ordered;
  }
}
