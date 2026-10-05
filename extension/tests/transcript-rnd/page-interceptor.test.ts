// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageInterceptor } from "../../src/transcript-rnd/page-interceptor";

class FakeXHR extends EventTarget {
  responseText = "";
  open = (..._args: unknown[]) => {};
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("pageInterceptor (MAIN world)", () => {
  let messages: Array<Record<string, unknown>>;
  const originalXHR = window.XMLHttpRequest;
  const originalFetch = window.fetch;

  beforeEach(() => {
    messages = [];
    (window as unknown as { __yairInterceptorInstalled?: boolean }).__yairInterceptorInstalled = undefined;
    window.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
    window.addEventListener("message", (event) => {
      if (event.data && typeof event.data === "object") messages.push(event.data as Record<string, unknown>);
    });
  });

  afterEach(() => {
    window.XMLHttpRequest = originalXHR;
    window.fetch = originalFetch;
  });

  it("emits a validated caption message for a timedtext XHR with a body", async () => {
    pageInterceptor({ token: "tok-9", source: "yair-rnd" });
    const xhr = new window.XMLHttpRequest() as unknown as FakeXHR;
    xhr.open("GET", "https://www.youtube.com/api/timedtext?v=abc&pot=xyz&fmt=json3");
    xhr.responseText = "{\"events\":[{\"segs\":[{\"utf8\":\"hi\"}]}]}";
    xhr.dispatchEvent(new Event("load"));
    await tick();
    const caption = messages.find((m) => m.type === "caption");
    expect(caption).toBeTruthy();
    expect(caption?.token).toBe("tok-9");
    expect(caption?.hasPot).toBe(true);
    expect(caption?.bytes).toBeGreaterThan(0);
    expect(String(caption?.text)).toContain("\"events\"");
  });

  it("ignores non-caption thumbnails/requests and empty bodies", async () => {
    pageInterceptor({ token: "tok-9" });
    const other = new window.XMLHttpRequest() as unknown as FakeXHR;
    other.open("GET", "https://www.youtube.com/api/stats/playback");
    other.responseText = "noise";
    other.dispatchEvent(new Event("load"));

    const empty = new window.XMLHttpRequest() as unknown as FakeXHR;
    empty.open("GET", "https://www.youtube.com/api/timedtext?v=abc");
    empty.responseText = "";
    empty.dispatchEvent(new Event("load"));

    await tick();
    expect(messages.filter((m) => m.type === "caption")).toHaveLength(0);
  });

  it("installs only once", async () => {
    pageInterceptor({ token: "tok-1" });
    pageInterceptor({ token: "tok-2" });
    expect((window as unknown as { __yairInterceptorInstalled?: boolean }).__yairInterceptorInstalled).toBe(true);
  });
});
