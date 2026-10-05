/**
 * R&D debug UI: run browser-side transcript extraction against the active
 * YouTube tab and show a human-readable card plus machine-readable JSON.
 */
import { BrowserTranscriptProvider, toIngestPayload } from "./browser-provider";
import { summarize } from "./parseJson3";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

function extractVideoId(input: string | null): string | null {
  if (!input) return null;
  const m = input.match(/[?&]v=([A-Za-z0-9_-]{11})/) || input.match(/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function renderFieldRows(fields: Array<[string, string, boolean?]>): void {
  const table = $("fields");
  table.innerHTML = "";
  for (const [key, value, ok] of fields) {
    const tr = document.createElement("tr");
    const k = document.createElement("td");
    k.className = "k";
    k.textContent = key;
    const v = document.createElement("td");
    v.textContent = value;
    if (ok !== undefined) v.className = ok ? "ok" : "fail";
    tr.append(k, v);
    table.append(tr);
  }
}

async function run(): Promise<void> {
  const status = $("status");
  const button = $<HTMLButtonElement>("run");
  const resultPanel = $("result");
  const json = $("json");
  button.disabled = true;
  status.textContent = "Running…";
  const t0 = performance.now();
  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("No active tab.");
    const urlId = extractVideoId($<HTMLInputElement>("url").value) ?? extractVideoId(tab.url ?? null);
    if (!urlId) throw new Error("No YouTube video id found on the active tab. Paste a watch URL.");

    const provider = new BrowserTranscriptProvider();
    const result = await provider.extract(tab.id, { prefLang: "en", interceptTimeoutMs: 25000, domFallbackMs: 8000 });
    const summary = result ? summarize(result.segments) : null;
    const payload = result ? toIngestPayload(result) : null;

    renderFieldRows([
      ["Video ID", urlId],
      ["Tab title", tab.title ?? "—"],
      ["Method", result?.method ?? "none"],
      ["Status", result ? "SUCCESS" : "FAILED", Boolean(result)],
      ["Latency", `${Math.round(result?.latencyMs ?? performance.now() - t0)} ms`],
      ["Segments", String(summary?.segmentCount ?? 0)],
      ["Characters", String(summary?.characterCount ?? 0)],
      ["Words", String(summary?.wordCount ?? 0)],
      ["Timestamped", summary ? String(summary.timestamped) : "—"],
      ["First timestamp", summary?.firstTimestamp != null ? `${summary.firstTimestamp.toFixed(1)}s` : "—"],
      ["Last timestamp", summary?.lastTimestamp != null ? `${summary.lastTimestamp.toFixed(1)}s` : "—"],
      ["Caption tracks", result?.captionTracks ? `${result.captionTracks.count} (manual ${result.captionTracks.manual}, asr ${result.captionTracks.asr})` : "—"],
      ["Source info", result ? JSON.stringify(result.sourceInfo) : "—"],
    ]);
    resultPanel.hidden = false;
    json.textContent = JSON.stringify(
      {
        video_id: urlId,
        method: result?.method ?? null,
        success: Boolean(result),
        latency_ms: Math.round(result?.latencyMs ?? performance.now() - t0),
        segment_count: summary?.segmentCount ?? 0,
        character_count: summary?.characterCount ?? 0,
        timestamped: summary?.timestamped ?? false,
        language: result?.language ?? null,
        ingest: payload,
        source_info: result?.sourceInfo ?? null,
      },
      null,
      2,
    );
    status.textContent = result ? `Done via ${result.method}.` : "No transcript obtained.";
  } catch (error) {
    status.textContent = `Error: ${(error as Error).message}`;
  } finally {
    button.disabled = false;
  }
}

$("run").addEventListener("click", () => void run());
