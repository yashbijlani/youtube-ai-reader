import { Icon } from "@/components/ui/Icons";
import { demo } from "@/content/demo";

const bars = [18, 34, 22, 46, 30, 58, 40, 26, 52, 38, 64, 28, 44, 20, 36, 50, 24, 42, 32, 56, 30, 46, 22, 38, 54, 28, 44, 34, 60, 26];

export function VideoCard({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col bg-ink-950 ${className}`.trim()}>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 18% 12%, #23232c 0%, #0c0c11 55%, #050507 100%)",
          }}
        />
        <div className="grid-bg absolute inset-0 opacity-40" />
        <div className="absolute inset-x-0 bottom-0 flex h-24 items-end gap-1 px-6 opacity-25">
          {bars.map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-full bg-gradient-to-t from-accent-deep to-accent"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>

        <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] font-medium text-ink-200 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-strong" />
          Live AI reading
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-sm">
            <Icon name="play" size={22} className="translate-x-0.5" />
          </span>
        </div>

        <div className="absolute bottom-4 right-5 rounded-md bg-black/75 px-2 py-0.5 font-mono text-[11px] tabular-nums text-white">
          {demo.video.duration}
        </div>

        <span className="absolute bottom-4 left-5 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(242,85,90,0.9)] backdrop-blur">
          <Icon name="spark" size={13} />
          Read with AI
        </span>

        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
          <div className="h-full bg-accent" style={{ width: `${demo.video.progress * 100}%` }} />
        </div>
      </div>

      <div className="border-t border-white/8 p-4">
        <h3 className="text-[15px] font-semibold leading-snug text-white">{demo.video.title}</h3>
        <div className="mt-2.5 flex items-center gap-2.5">
          <span
            className="h-7 w-7 rounded-full"
            style={{ background: "linear-gradient(135deg, #3b3b47, #17171d)" }}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink-100">{demo.video.channel}</p>
            <p className="text-[11.5px] text-ink-400">{demo.video.meta}</p>
          </div>
          <span className="ml-auto hidden rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-ink-950 sm:inline-flex">
            Subscribe
          </span>
        </div>

        <div className="mt-4 flex items-center gap-3 font-mono text-[11px] tabular-nums text-ink-400">
          <span className="text-ink-200">{demo.video.elapsed}</span>
          <div className="relative h-1 flex-1 rounded-full bg-white/10">
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${demo.video.progress * 100}%` }} />
            <span className="absolute -top-[3px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${demo.video.progress * 100}%` }} />
          </div>
          <span>{demo.video.duration}</span>
        </div>
      </div>

      <div className="hidden flex-1 flex-col gap-4 border-t border-white/8 p-4 lg:flex">
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            Description
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-300">
            A practical look at the reasoning habits behind great engineering, from first principles
            to feedback loops.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {["engineering", "mental models", "systems"].map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-ink-400"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
            Up next
          </p>
          {demo.upNext.map((item) => (
            <div key={item.title} className="flex items-center gap-3">
              <span
                className="h-11 w-[76px] flex-none rounded-lg border border-white/8"
                style={{
                  background: "radial-gradient(120% 120% at 20% 10%, #23232c, #0b0b0e 80%)",
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink-100">
                  {item.title}
                </span>
                <span className="block text-[11px] text-ink-400">{item.meta}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
