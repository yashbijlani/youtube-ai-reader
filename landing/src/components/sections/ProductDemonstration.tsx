import { ReaderPanel } from "@/components/mock/ReaderPanel";
import { Container } from "@/components/ui/Container";
import { Icon, type IconName } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { TimestampChip } from "@/components/ui/TimestampChip";

const tour: Array<{ icon: IconName; title: string; body: string; time?: string }> = [
  {
    icon: "book",
    title: "Overview",
    body: "A concise, readable explanation of what the video is actually about.",
  },
  {
    icon: "spark",
    title: "Key ideas",
    body: "First principle thinking, feedback loops, reducing complexity, mental models.",
  },
  {
    icon: "list",
    title: "Chapters",
    body: "Move through the video by topic instead of scrubbing the timeline.",
    time: "34:10",
  },
  {
    icon: "chat",
    title: "Ask the video",
    body: "Get answers grounded in the transcript, with clickable timestamps to the moment.",
    time: "19:18",
  },
];

export function ProductDemonstration() {
  return (
    <Section className="border-t border-white/8">
      <Container>
        <SectionHeading
          eyebrow='Example · "How Great Engineers Think"'
          title="From two hours of video to something you can actually use."
          description="The same piece of content, in a form you can read, scan and question."
        />

        <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-stretch lg:gap-14">
          <div className="flex flex-col justify-center gap-3">
            {tour.map((item, index) => (
              <Reveal key={item.title} delay={index * 70}>
                <div className="flex gap-4 rounded-2xl border border-white/8 bg-white/[0.015] p-5">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-ink-200">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-white">{item.title}</h3>
                      {item.time ? <TimestampChip time={item.time} active /> : null}
                    </div>
                    <p className="text-sm leading-relaxed text-ink-300">{item.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="relative">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-6 -z-10 opacity-60"
                style={{
                  background:
                    "radial-gradient(60% 55% at 60% 40%, rgba(242,85,90,0.14), transparent 70%)",
                }}
              />
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-[0_30px_90px_-40px_rgba(0,0,0,0.9)]">
                <ReaderPanel />
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
