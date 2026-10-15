import { describe, expect, it } from "vitest";
import type { AgAiThread } from "ag-studio";
import { createMemoryHistoryStore } from "./nudge-history";

const thread = (threadId: string, updatedAt: number, parentThreadId?: string): AgAiThread => ({
  summary: { threadId, agentId: "nudge", updatedAt, parentThreadId },
  messages: [{ id: `${threadId}-m`, role: "user", parts: [{ type: "text", text: "hi" }], createdAt: 1 }],
});

describe("createMemoryHistoryStore", () => {
  it("keeps threads and lists them oldest first, so Studio reopens the newest", async () => {
    const store = createMemoryHistoryStore();
    await store.saveThread(thread("b", 5));
    await store.saveThread(thread("a", 2));
    await store.saveThread(thread("b", 9));
    expect((await store.listThreads()).map((s) => s.threadId)).toEqual(["a", "b"]);
    expect((await store.loadThread("b"))?.summary.updatedAt).toBe(9);
    expect(await store.loadThread("nope")).toBeUndefined();
  });

  it("deletes a thread and anything nested under it", async () => {
    const store = createMemoryHistoryStore();
    await store.saveThread(thread("a", 1));
    await store.saveThread(thread("a-sub", 2, "a"));
    await store.saveThread(thread("c", 3));
    await store.deleteThread("a");
    expect((await store.listThreads()).map((s) => s.threadId)).toEqual(["c"]);
  });

  it("deletes nested threads at every depth", async () => {
    const store = createMemoryHistoryStore();
    await store.saveThread(thread("a", 1));
    await store.saveThread(thread("b", 2, "a"));
    await store.saveThread(thread("c", 3, "b"));
    await store.saveThread(thread("d", 4, "c"));
    await store.saveThread(thread("other", 5));
    await store.deleteThread("a");
    expect((await store.listThreads()).map((s) => s.threadId)).toEqual(["other"]);
    expect(await store.loadThread("d")).toBeUndefined();
  });

  it("outlives the harness that wrote to it", async () => {
    const store = createMemoryHistoryStore();
    await store.saveThread(thread("a", 1));
    // A remounted Studio builds a new harness but reads the same store.
    expect(await store.listThreads()).toHaveLength(1);
  });
});
