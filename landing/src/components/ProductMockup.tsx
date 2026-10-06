import { ReaderPanel } from "@/components/mock/ReaderPanel";
import { VideoCard } from "@/components/mock/VideoCard";
import { Icon } from "@/components/ui/Icons";

export function ProductMockup() {
  return (
    <figure className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 0%, rgba(242,85,90,0.16), transparent 70%)",
        }}
      />

      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] ring-1 ring-black/40"
      >
        <div className="flex h-9 items-center gap-2 border-b border-white/8 bg-ink-850 px-3.5">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          </span>
          <div className="mx-auto flex h-6 w-full max-w-sm items-center justify-center gap-1.5 rounded-md border border-white/8 bg-ink-900 px-3 text-[11px] text-ink-400">
            <Icon name="lock" size={11} />
            <span className="truncate">youtube.com/watch?v=great-engineers</span>
          </div>
          <span className="hidden text-ink-500 sm:block">
            <Icon name="settings" size={13} />
          </span>
        </div>

        <div className="flex flex-col lg:h-[940px] lg:flex-row">
          <VideoCard className="lg:min-w-0 lg:flex-1" />
          <ReaderPanel className="h-[820px] border-t border-white/8 lg:h-auto lg:w-[360px] lg:flex-none lg:border-l lg:border-t-0" />
        </div>
      </div>

      <figcaption className="sr-only">
        A YouTube watch page with the YouTube AI Reader side panel open, showing an
        overview, key ideas, chapters and a grounded answer with timestamped citations.
      </figcaption>
    </figure>
  );
}
