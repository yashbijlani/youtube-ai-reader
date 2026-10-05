import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllConversations,
  clearConversation,
  loadConversation,
  newMessage,
  saveConversation,
} from "../src/lib/chatStore";

describe("chatStore", () => {
  beforeEach(async () => {
    await clearAllConversations();
  });

  it("stores conversations per video", async () => {
    const first = newMessage({ role: "user", content: "hello video A", citations: [] });
    await saveConversation({
      videoId: "aaaaaaaaaaa",
      title: "Video A",
      messages: [first],
      updatedAt: 0,
    });
    const second = newMessage({ role: "user", content: "hello video B", citations: [] });
    await saveConversation({
      videoId: "bbbbbbbbbbb",
      title: "Video B",
      messages: [second],
      updatedAt: 0,
    });

    const a = await loadConversation("aaaaaaaaaaa");
    const b = await loadConversation("bbbbbbbbbbb");
    expect(a?.messages[0].content).toBe("hello video A");
    expect(b?.messages[0].content).toBe("hello video B");
  });

  it("updates an existing conversation", async () => {
    await saveConversation({
      videoId: "aaaaaaaaaaa",
      messages: [newMessage({ role: "user", content: "one", citations: [] })],
      updatedAt: 0,
    });
    await saveConversation({
      videoId: "aaaaaaaaaaa",
      messages: [
        newMessage({ role: "user", content: "one", citations: [] }),
        newMessage({ role: "assistant", content: "two", citations: [] }),
      ],
      updatedAt: 0,
    });
    const conversation = await loadConversation("aaaaaaaaaaa");
    expect(conversation?.messages).toHaveLength(2);
  });

  it("clears a single conversation and all conversations", async () => {
    await saveConversation({
      videoId: "aaaaaaaaaaa",
      messages: [],
      updatedAt: 0,
    });
    await clearConversation("aaaaaaaaaaa");
    expect(await loadConversation("aaaaaaaaaaa")).toBeNull();

    await saveConversation({ videoId: "bbbbbbbbbbb", messages: [], updatedAt: 0 });
    await clearAllConversations();
    expect(await loadConversation("bbbbbbbbbbb")).toBeNull();
  });

  it("creates unique message ids", () => {
    const one = newMessage({ role: "user", content: "a", citations: [] });
    const two = newMessage({ role: "user", content: "a", citations: [] });
    expect(one.id).not.toBe(two.id);
  });
});
