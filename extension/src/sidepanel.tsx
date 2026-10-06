import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AccountMenu } from "./components/AccountMenu";
import { ChatTab } from "./components/ChatTab";
import { EmptyView } from "./components/EmptyView";
import { ErrorView } from "./components/ErrorView";
import { Header } from "./components/Header";
import { LoadingView } from "./components/LoadingView";
import { OverviewTab } from "./components/OverviewTab";
import { Paywall } from "./components/Paywall";
import { SignInView } from "./components/SignInView";
import { Tabs } from "./components/Tabs";
import { useChat } from "./hooks/useChat";
import { useAnalysisStream } from "./hooks/useAnalysisStream";
import { useAuth } from "./hooks/useAuth";
import { useEntitlement } from "./hooks/useEntitlement";
import { useVideoContext } from "./hooks/useVideoContext";
import { useVideoReader } from "./hooks/useVideoReader";
import { api } from "./lib/api";
import { sendMessage } from "./lib/messaging";
import { DEFAULT_API_BASE_URL, getSettings } from "./lib/storage";
import type { Analysis, TabId, Transcript } from "./types";
import "./styles.css";

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [tab, setTab] = useState<TabId>("overview");
  const [transcript, setTranscript] = useState<Transcript | null>(null);

  const context = useVideoContext();
  const video = context.video;
  const auth = useAuth();
  const reader = useVideoReader(video, apiBaseUrl, context.requestedVideoId, context.tabId);
  const chat = useChat(video, apiBaseUrl, context.playbackSeconds);
  const entitlement = useEntitlement(apiBaseUrl);

  useEffect(() => {
    if (reader.state?.status === "ready") void entitlement.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader.state?.status, video?.videoId]);

  useEffect(() => {
    void getSettings().then((settings) => {
      console.log("[yair] panel backend=", settings.apiBaseUrl);
      setApiBaseUrl(settings.apiBaseUrl);
    });
  }, []);

  const rawState = reader.state;
  // Never render a state that belongs to a different video than the tab's.
  const state =
    rawState && video && rawState.video_id !== video.videoId ? null : rawState;
  const ready = state?.status === "ready";
  const guideReady = ready && state?.analysis_status === "ready" && Boolean(state?.analysis);
  const lastVideoRef = useRef<string | null>(null);
  const authKeyRef = useRef<string | null | undefined>(undefined);

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

  // Reset the tab when the video changes; Overview is always the landing page.
  useEffect(() => {
    const id = video?.videoId ?? null;
    if (id !== lastVideoRef.current) {
      lastVideoRef.current = id;
      setTab("overview");
    }
  }, [video?.videoId]);

  // When the signed-in account changes (sign in, switch, sign out), discard any
  // stale free-limit/error state so the page reflects the new credentials.
  useEffect(() => {
    if (auth.loading) return;
    const current = auth.session?.user.id ?? null;
    if (authKeyRef.current === undefined) {
      authKeyRef.current = current; // first settled value (session restore)
      return;
    }
    if (authKeyRef.current === current) return;
    authKeyRef.current = current;
    reader.clearLimitReached();
    reader.clearError();
    setTab("overview");
    if (video) void reader.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.session?.user.id, video?.videoId]);

  const handleTabChange = useCallback((next: TabId) => setTab(next), []);

  const seek = useCallback(
    (seconds: number) => {
      void sendMessage({ type: "SEEK_TO", seconds, videoId: video?.videoId, tabId: context.tabId });
    },
    [video?.videoId, context.tabId],
  );

  const counts = useMemo(
    () => ({
      chat: chat.messages.length,
    }),
    [chat.messages.length],
  );

  const handleCancel = useCallback(() => {
    if (!video) return;
    void api.cancel(apiBaseUrl, video.videoId).finally(() => void reader.refresh());
  }, [apiBaseUrl, reader, video]);

  const switchAccount = useCallback(async () => {
    await auth.signOut();
    await auth.signInWithGoogle();
  }, [auth]);

  const needsSignIn = auth.configured && !auth.loading && !auth.session;

  let body: React.ReactNode;
  if (!video) {
    body = (
      <div className="center-state">
        <span className="state-icon">▶</span>
        <h3>Turned off</h3>
        <p>
          YouTube AI Reader only works on YouTube watch pages. Open a video and click{" "}
          <strong>✨ Read with AI</strong>.
        </p>
      </div>
    );
  } else if (reader.limitReached) {
    body = (
      <Paywall
        used={entitlement.used}
        limit={entitlement.limit}
        onUpgrade={entitlement.openPayment}
        onSwitchAccount={() => void switchAccount()}
        onDismiss={reader.clearLimitReached}
        upgradeError={entitlement.error}
      />
    );
  } else if (needsSignIn) {
    body = <SignInView auth={auth} />;
  } else if (reader.error) {
    body = (
      <ErrorView
        error={reader.error}
        busy={reader.starting}
        onRetry={() => void reader.process(false)}
        onReprocess={() => void reader.process(true)}
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
          <div className={`content-inner${tab === "chat" ? " content-fill" : ""}`}>
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
                chapters={mergedAnalysis?.chapters ?? []}
                transcript={transcript}
                playbackSeconds={context.playbackSeconds}
              />
            ) : null}
            {tab === "chat" ? (
              <ChatTab
                controller={chat}
                onSeek={seek}
                playbackSeconds={context.playbackSeconds}
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
          account={
            <AccountMenu
              auth={auth}
              plan={{
                paid: entitlement.paid,
                used: entitlement.used,
                limit: entitlement.limit,
                remaining: entitlement.remaining,
                onUpgrade: entitlement.openPayment,
              }}
            />
          }
        />
      ) : null}
      {body}
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
