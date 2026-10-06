import { BrandMark, Icon } from "@/components/ui/Icons";
import { TimestampChip } from "@/components/ui/TimestampChip";
import { demo } from "@/content/demo";

const tabs = [
  { label: "Overview", active: true },
  { label: "Chapters", active: false },
  { label: "Transcript", active: false },
  { label: "Chat", active: false },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        {children}
      </span>
      <span className="h-px flex-1 bg-white/8" />
    </div>
  );
}

export function ReaderPanel({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-full min-h-0 flex-col bg-ink-900 ${className}`.trim()}>
      <div className="border-b border-white/8 px-3.5 pb-2.5 pt-3">
        <div className="flex items-center gap-2">
          <BrandMark size={20} />
          <span className="text-[12.5px] font-semibold text-white">YouTube AI Reader</span>
          <span className="ml-auto flex items-center gap-1 text-ink-400">
            <Icon name="refresh" size={14} />
            <Icon name="settings" size={14} />
          </span>
        </div>
        <p className="mt-2.5 line-clamp-1 text-[13px] font-semibold text-ink-50">
          {demo.video.title}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-bright">
            <span className="h-1 w-1 rounded-full bg-accent-strong" />
            Ready
          </span>
          <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-300">
            {demo.video.duration}
          </span>
        </div>
      </div>

      <div className="flex gap-1 px-2 pb-1 pt-2">
        {tabs.map((tab) => (
          <span
            key={tab.label}
            className={`flex-1 rounded-lg py-1.5 text-center text-[11px] font-medium ${
              tab.active ? "bg-accent/12 text-accent-bright" : "text-ink-400"
            }`}
          >
            {tab.label}
          </span>
        ))}
      </div>

      <div className="scrollbar-thin relative flex-1 overflow-hidden px-3.5 pb-3 pt-3">
        <SectionLabel>Overview</SectionLabel>
        <p className="text-[12.5px] leading-relaxed text-ink-100">{demo.overview}</p>

        <div className="mt-4">
          <SectionLabel>Key ideas</SectionLabel>
          <ul className="grid grid-cols-2 gap-1.5">
            {demo.keyIdeas.map((idea, index) => (
              <li
                key={idea}
                className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2 py-2"
              >
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-accent/12 text-[10px] font-semibold text-accent-bright">
                  {index + 1}
                </span>
                <span className="text-[11.5px] font-medium leading-tight text-ink-50">{idea}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <SectionLabel>Chapters</SectionLabel>
          <ul className="flex flex-col">
            {demo.chapters.map((chapter) => (
              <li
                key={chapter.time}
                className="flex items-center gap-2.5 border-b border-white/6 py-1 last:border-0"
              >
                <TimestampChip time={chapter.time} active={chapter.time === "19:18"} />
                <span className="text-[12.5px] text-ink-200">{chapter.title}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <SectionLabel>Ask</SectionLabel>
          <div className="flex justify-end">
            <span className="rounded-xl rounded-br-sm bg-accent px-2.5 py-1.5 text-[11.5px] leading-snug text-white">
              {demo.question}
            </span>
          </div>
          <div className="mt-2.5 rounded-xl border border-white/8 bg-white/[0.02] p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">
              <BrandMark size={13} />
              Grounded in transcript
            </div>
            <ul className="mt-2 flex flex-col gap-1.5">
              {demo.answer.points.map((point) => (
                <li key={point.time} className="flex gap-2">
                  <TimestampChip time={point.time} active className="mt-0.5 flex-none" />
                  <span className="text-[12px] leading-relaxed text-ink-100">{point.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-white/8 p-3">
        <div className="flex items-center gap-2 rounded-xl border border-white/12 bg-ink-850 px-3 py-2.5">
          <Icon name="chat" size={15} className="text-ink-400" />
          <span className="flex-1 text-[12px] text-ink-400">Ask about this video…</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-white">
            <Icon name="arrowRight" size={13} />
          </span>
        </div>
      </div>
    </div>
  );
}
