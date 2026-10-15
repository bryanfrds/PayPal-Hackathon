// Where Nudge's conversations live while the tab is open. Studio's harness is rebuilt whenever
// the dashboard remounts (crossing between the phone and wide layouts), so the threads are kept
// here, outside React, and Studio reopens the newest one. Nothing is written to disk: a reload
// starts fresh, like the Nudge chat.

import type { AgAiHistoryStore, AgAiHistoryStoreEventListener, AgAiThread, AgAiThreadSummary } from "ag-studio";

export function createMemoryHistoryStore(): AgAiHistoryStore {
  const threads = new Map<string, AgAiThread>();
  const listeners = new Set<AgAiHistoryStoreEventListener>();

  return {
    // Oldest first: Studio opens the last one in the list when the panel starts.
    async listThreads(): Promise<AgAiThreadSummary[]> {
      return [...threads.values()].map((t) => t.summary).sort((a, b) => a.updatedAt - b.updatedAt);
    },
    async loadThread(threadId) {
      return threads.get(threadId);
    },
    async saveThread(thread) {
      threads.set(thread.summary.threadId, thread);
    },
    async deleteThread(threadId) {
      threads.delete(threadId);
      // Anything nested under it goes too.
      for (const [id, t] of threads) if (t.summary.parentThreadId === threadId) threads.delete(id);
    },
    // Only this tab writes here, so there are never outside changes to announce.
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
}

/** One store for the whole tab, shared by every mount of Insights. */
export const nudgeHistory = createMemoryHistoryStore();
