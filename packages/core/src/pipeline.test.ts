// packages/core/src/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./pipeline.js";
import type { Source, UpsertOutcome } from "./types.js";
import { z } from "zod";

interface TestRecord {
  id: string;
  value: number;
}

const record: TestRecord = { id: "T-001", value: 1 };

const schema = z.object({
  id: z.string(),
  value: z.number(),
});

describe("runPipeline", () => {
  it("upserts a record and returns new=1", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(upsert).toHaveBeenCalledWith("test.source", "hash-abc", record);
    expect(result.new).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.fetched).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("counts an 'updated' outcome from upsert", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("updated");
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.new).toBe(0);
    expect(result.updated).toBe(1);
  });

  it("skips records where source.filter returns false", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    const result = await runPipeline({ source, upsert });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.new).toBe(0);
  });

  it("counts pagesFetched and emptyPages across multiple pages", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    let call = 0;
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => {
        call++;
        if (call === 1) return { raw: [], nextCursor: "2" };
        if (call === 2) return { raw: [record], nextCursor: "3" };
        return { raw: [] };
      },
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.pagesFetched).toBe(3);
    expect(result.emptyPages).toBe(2);
  });

  it("emptyPages equals pagesFetched when every page returns zero rows", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    const result = await runPipeline({ source, upsert });

    expect(result.pagesFetched).toBe(1);
    expect(result.emptyPages).toBe(1);
  });

  it("calls onValidated for each validated record, even when the filter skips it", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const onValidated = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    const result = await runPipeline({ source, upsert, onValidated });

    expect(onValidated).toHaveBeenCalledWith(record);
    expect(result.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("calls onChanged with the outcome for created and updated records", async () => {
    const upsert = vi
      .fn<() => Promise<UpsertOutcome>>()
      .mockResolvedValueOnce("created")
      .mockResolvedValueOnce("updated");
    const onChanged = vi.fn();
    let call = 0;
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => {
        call++;
        if (call === 1) return { raw: [record], nextCursor: "2" };
        return { raw: [{ id: "T-002", value: 2 }] };
      },
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, onChanged });

    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenNthCalledWith(1, record, "created", undefined);
    expect(onChanged).toHaveBeenNthCalledWith(2, { id: "T-002", value: 2 }, "updated", undefined);
  });

  it("does not call onChanged for an 'unchanged' outcome", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("unchanged");
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, onChanged });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("does not call getPrevious or onChanged for records skipped by the filter", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const getPrevious = vi.fn();
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
      filter: () => false,
    };

    await runPipeline({ source, upsert, getPrevious, onChanged });

    expect(getPrevious).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("threads getPrevious's result through to onChanged", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("updated");
    const previous = { id: "T-001", value: 0 };
    const getPrevious = vi.fn().mockResolvedValue(previous);
    const onChanged = vi.fn();
    const source: Source<TestRecord, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [record] }),
      parse: (r) => r,
      schema,
      contentHash: () => "hash-abc",
    };

    await runPipeline({ source, upsert, getPrevious, onChanged });

    expect(getPrevious).toHaveBeenCalledWith(record);
    expect(onChanged).toHaveBeenCalledWith(record, "updated", previous);
  });

  it("logs row_error and continues when schema validation fails", async () => {
    const upsert = vi.fn<() => Promise<UpsertOutcome>>().mockResolvedValue("created");
    const source: Source<unknown, TestRecord> = {
      id: "test.source",
      fetchPage: async () => ({ raw: [{ id: "bad", value: "not-a-number" }] }),
      parse: (r) => r as TestRecord,
      schema,
      contentHash: () => "hash-abc",
    };

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runPipeline({ source, upsert });

    expect(upsert).not.toHaveBeenCalled();
    expect(result.errors).toBe(1);
    expect(result.fetched).toBe(1);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
