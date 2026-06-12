/**
 * In-memory implementation of the supermemory SDK surface that the
 * `Brain` class uses. Lets debug commands exercise the full Brain
 * flow (including `Brain.add`, `Brain.get`, `Brain.search`, etc.)
 * without any network calls or API key.
 *
 * Storage shape: a `Map<id, StoredDoc>` keyed by an internal id; lookups
 * by `customId` are done by linear scan. `containerTag` is recorded at
 * `add()` time and filtered on `list()`. `search.execute` does a
 * case-insensitive substring match against `content`.
 *
 * This is NOT a complete supermemory clone — it only implements the
 * methods Brain calls. Adding a new Brain method that needs a
 * different SDK method will require extending this stub.
 */
interface StoredDoc {
  id: string;
  customId: string | null;
  containerTag: string;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
}

export class MemoryStub {
  readonly docs = new Map<string, StoredDoc>();
  private nextId = 0;

  documents = {
    add: async (params: {
      content: string;
      containerTag: string;
      customId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const id = `stub-${++this.nextId}`;
      this.docs.set(id, {
        id,
        customId: params.customId ?? null,
        containerTag: params.containerTag,
        content: params.content,
        summary: null,
        metadata: params.metadata ?? null,
      });
      return { id, status: "done" };
    },
    list: async (params: { containerTags?: Array<string>; limit?: number }) => {
      const tags = params.containerTags ?? [];
      const limit = params.limit ?? 200;
      const all = Array.from(this.docs.values()).filter((d) =>
        tags.length === 0 ? true : tags.includes(d.containerTag),
      );
      const memories = all.slice(0, limit).map((d) => ({
        id: d.id,
        customId: d.customId,
        containerTag: d.containerTag,
        content: d.content,
        summary: d.summary,
        metadata: d.metadata,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "done" as const,
        type: "text" as const,
        connectionId: null,
        filepath: null,
        title: null,
      }));
      return {
        memories,
        pagination: {
          currentPage: 1,
          totalItems: memories.length,
          totalPages: 1,
          limit,
        },
      };
    },
    get: async (id: string) => {
      const d = this.docs.get(id);
      if (!d) {
        throw new Error(`MemoryStub.documents.get: no such id ${id}`);
      }
      return {
        id: d.id,
        customId: d.customId,
        containerTag: d.containerTag,
        content: d.content,
        summary: d.summary,
        metadata: d.metadata,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        status: "done" as const,
        type: "text" as const,
        connectionId: null,
        filepath: null,
        title: null,
        source: null,
        ogImage: null,
        raw: null,
        spatialPoint: null,
        taskType: "memory" as const,
        url: null,
      };
    },
  };

  search = {
    execute: async (params: {
      q: string;
      containerTag?: string;
      limit?: number;
      onlyMatchingChunks?: boolean;
    }) => {
      const q = params.q.toLowerCase();
      const limit = params.limit ?? 5;
      const hits = Array.from(this.docs.values())
        .filter(
          (d) =>
            (params.containerTag
              ? d.containerTag === params.containerTag
              : true) && d.content.toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map((d, i) => ({
          chunks: [
            {
              content: d.content,
              isRelevant: true,
              score: 1 - i * 0.1,
            },
          ],
          summary: d.summary,
          score: 1 - i * 0.1,
          documentId: d.id,
          metadata: d.metadata as Record<string, unknown> | null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          title: d.customId,
          type: "text" as const,
        }));
      return {
        results: hits,
        total: hits.length,
        timing: 0,
      };
    },
  };
}
