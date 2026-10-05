import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChaptersTab } from "./components/ChaptersTab";
import { ChatTab } from "./components/ChatTab";
import { EmptyView } from "./components/EmptyView";
import { ErrorView } from "./components/ErrorView";
import { Header } from "./components/Header";
import { LoadingView } from "./components/LoadingView";
import { OverviewTab } from "./components/OverviewTab";
import { Paywall } from "./components/Paywall";
import { SettingsSheet } from "./components/SettingsSheet";
import { Tabs } from "./components/Tabs";
import { TranscriptTab } from "./components/TranscriptTab";
import { useChat } from "./hooks/useChat";
import { useAnalysisStream } from "./hooks/useAnalysisStream";
import { useEntitlement } from "./hooks/useEntitlement";
import { useVideoContext } from "./hooks/useVideoContext";
import { useVideoReader } from "./hooks/useVideoReader";
import { api } from "./lib/api";
import { clearAllConversations } from "./lib/chatStore";
import { sendMessage } from "./lib/messaging";
import { DEFAULT_API_BASE_URL, getSettings, saveSettings } from "./lib/storage";
import type { Analysis, TabId, Transcript } from "./types";
import "./styles.css";

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");
  const [transcript, setTranscript] = useState<Transcript | null>(null);

  const context = useVideoContext();
  const video = context.video;
  const reader = useVideoReader(video, apiBaseUrl, context.requestedVideoId);
  const chat = useChat(video, apiBaseUrl, context.playbackSeconds);
  const entitlement = useEntitlement(apiBaseUrl);

  useEffect(() => {
    if (reader.state?.status === "ready") void entitlement.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.state?.status, video?.videoId]);

  useEffect(() => {
    void getSettings().then((settings) => setApiBaseUrl(settings.apiBaseUrl));
  }, []);

  const state = reader.state;
  const ready = state?.status === "ready";
  const guideReady = ready && state?.analysis_status === "ready" && Boolean(state?.analysis);
  const lastVideoRef = useRef<string | null>(null);
  const userPickedTabRef = useRef(false);

  const live = useAnalysisStream(
    video,
    apiBaseUrl,
    Boolean(ready && state?.analysis_status !== "ready"),
  );

  const mergedAnalysis: Analysis | null = useMemo(() => {
    const base = state?.analysis ?? null;
    if (!base && !live.overview && live.chapters.length === 0 && !live.reading) return null;
    return {
      overview: base?.overview || live.overview,
      key_points: base?.key_points?.length ? base.key_points : live.keyPoints,
      chapters: base?.chapters?.length ? base.chapters : live.chapters,
      detailed_reading: base?.detailed_reading || live.reading,
      generated_by: base?.generated_by ?? null,
      prompt_version: base?.prompt_version ?? null,
      degraded: base?.degraded ?? false,
      degraded_reason: base?.degraded_reason ?? null,
    };
  }, [state?.analysis, live.overview, live.keyPoints, live.chapters, live.reading]);

  useEffect(() => {
    let cancelled = false;
    setTranscript(null);
    if (ready && video) {
      void api
        .getTranscript(apiBaseUrl, video.videoId)
        .then((value) => {
          if (!cancelled) setTranscript(value);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [ready, video?.videoId, apiBaseUrl]);

  // Reset tab choice when the video changes.
  useEffect(() => {
    const id = video?.videoId ?? null;
    if (id !== lastVideoRef.current) {
      lastVideoRef.current = id;
      userPickedTabRef.current = false;
      setTab("overview");
    }
  }, [video?.videoId]);

  // Land on Chat while the guide is still being written; switch to Overview
  // once (and only once) the guide is ready, unless the user picked a tab.
  useEffect(() => {
    if (!ready || userPickedTabRef.current) return;
    setTab(guideReady ? "overview" : "chat");
  }, [ready, guideReady]);

  const handleTabChange = useCallback((next: TabId) => {
    userPickedTabRef.current = true;
    setTab(next);
  }, []);

  const seek = useCallback(
    (seconds: number) => {
      void sendMessage({ type: "SEEK_TO", seconds, videoId: video?.videoId });
    },
    [video?.videoId],
  );

  const counts = useMemo(
    () => ({
      chapters: mergedAnalysis?.chapters.length ?? 0,
      transcript: transcript?.segments.length ?? 0,
      chat: chat.messages.length,
    }),
    [mergedAnalysis?.chapters.length, transcript?.segments.length, chat.messages.length],
  );

  const handleCancel = useCallback(() => {
    if (!video) return;
    void api.cancel(apiBaseUrl, video.videoId).finally(() => void reader.refresh());
  }, [apiBaseUrl, reader, video]);

  const handleSaveUrl = useCallback(async (url: string) => {
    setApiBaseUrl(url);
    await saveSettings({ apiBaseUrl: url });
  }, []);

  let body: React.ReactNode;
  if (!video) {
    body = (
      <div className="center-state">
        <span className="state-icon">▶</span>
        <h3>Open a YouTube video</h3>
        <p>
          Navigate to any YouTube watch page and click <strong>✨ Read with AI</strong> to
          build a reading experience for it.
        </p>
      </div>
    );
  } else if (reader.limitReached) {
    body = (
      <Paywall
        used={entitlement.used}
        limit={entitlement.limit}
        onUpgrade={entitlement.openPayment}
        onTrial={entitlement.openTrial}
        onManage={entitlement.manage}
        onDismiss={reader.clearLimitReached}
      />
    );
  } else if (reader.error) {
    body = (
      <ErrorView
        error={reader.error}
        busy={reader.starting}
        onRetry={() => void reader.process(false)}
        onReprocess={() => void reader.process(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  } else if (state?.status === "error") {
    const error = state.error ?? { code: "unknown_error", message: "Processing failed." };
    body = (
      <ErrorView
        error={error}
        busy={reader.starting}
        onRetry={() => void reader.process(false)}
        onReprocess={() => void reader.process(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
    );
  } else if (state?.status === "processing") {
    body = (
      <LoadingView
        stage={state.stage}
        stageMessage={state.stage_message}
        onCancel={handleCancel}
        busy={reader.starting}
      />
    );
  } else if (ready) {
    body = (
      <>
        <Tabs active={tab} onChange={handleTabChange} counts={counts} />
        <main className="content">
          <div className="content-inner">
            {tab === "overview" ? (
              <OverviewTab
                analysis={mergedAnalysis}
                analysisStatus={state?.analysis_status ?? "pending"}
                onSeek={seek}
                onReprocess={() => void reader.repair()}
                reprocessing={reader.starting}
                streamingReading={live.streaming && !state?.analysis?.detailed_reading}
                quickRead={live.quickRead}
                quickReadStreaming={live.quickReadStreaming}
              />
            ) : null}
            {tab === "chapters" ? (
              <ChaptersTab
                chapters={mergedAnalysis?.chapters ?? []}
                playbackSeconds={context.playbackSeconds}
                onSeek={seek}
              />
            ) : null}
            {tab === "transcript" ? (
              transcript ? (
                <TranscriptTab
                  transcript={transcript}
                  playbackSeconds={context.playbackSeconds}
                  onSeek={seek}
                />
              ) : (
                <div className="center-state">
                  <p>Loading transcript…</p>
                </div>
              )
            ) : null}
            {tab === "chat" ? (
              <ChatTab
                video={video}
                controller={chat}
                onSeek={seek}
                playbackSeconds={context.playbackSeconds}
                onOpenSettings={() => setSettingsOpen(true)}
                ready={ready}
                guideReady={guideReady}
              />
            ) : null}
          </div>
        </main>
      </>
    );
  } else {
    body = (
      <EmptyView
        video={video}
        busy={reader.starting}
        onGenerate={() => void reader.process(false)}
        message={null}
      />
    );
  }

  const showHeader = Boolean(video);

  return (
    <div className="app">
      {showHeader ? (
        <Header
          video={video!}
          state={state}
          onRefresh={() => void reader.process(true)}
          refreshing={reader.starting}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}
      {body}
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiBaseUrl={apiBaseUrl}
        onSaveApiBaseUrl={handleSaveUrl}
        video={video}
        hasConversation={chat.messages.length > 0}
        onClearConversation={() => void chat.clear()}
        onClearAllConversations={() => {
          void clearAllConversations().then(() => chat.clear());
        }}
        plan={{
          paid: entitlement.paid,
          used: entitlement.used,
          limit: entitlement.limit,
          remaining: entitlement.remaining,
          onUpgrade: entitlement.openPayment,
          onManage: entitlement.manage,
          onTrial: entitlement.openTrial,
        }}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
