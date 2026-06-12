/** A brain's logical namespace. Maps to supermemory's `containerTag`. */
export interface Space {
  name: string;
  description?: string;
}

/** Metadata bag stored alongside a document in supermemory. */
export type FactMetadata = Record<string, string | number | boolean | string[]>;

/**
 * A fact/document to store in the brain's memory. Mirrors supermemory's
 * `documents.add` parameter shape: `content` is the canonical text (or
 * JSON-encoded schedule), `customId` is the stable lookup key, and
 * `metadata` is the filterable bag.
 */
export interface FactInput {
  customId: string;
  content: string;
  metadata?: FactMetadata;
}

/** A single semantic-search hit. */
export interface SearchHit {
  content: string;
  score: number;
}
