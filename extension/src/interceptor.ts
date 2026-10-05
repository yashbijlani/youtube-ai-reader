/**
 * MAIN-world caption interceptor bootstrapped at document_start.
 *
 * Installed as a content script (`world: "MAIN"`, `run_at: "document_start"`)
 * so it is active before YouTube's player makes its first signed `/api/timedtext`
 * request. That initial response is the complete caption track; injecting late
 * (after load) only observes later partial windows on long videos.
 *
 * The interceptor is narrowly scoped to `/api/timedtext` and never reads
 * cookies, auth headers, request bodies, or unrelated traffic.
 */
import { pageInterceptor } from "./transcript-rnd/page-interceptor";

pageInterceptor({ token: "yair-page", source: "yair-rnd", patchFetch: true });
