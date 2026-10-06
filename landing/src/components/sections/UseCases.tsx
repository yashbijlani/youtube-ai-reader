import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { useCases } from "@/content/useCases";

const trackFills = [
  [0.18, 0.42, 0.68, 0.9],
  [0.25, 0.5, 0.75, 1],
  [0.3, 0.55, 0.8, 1],
  [0.15, 0.35, 0.6, 0.85],
];

export function UseCases() {
  return (
    <Section className="border-t border-white/8">
      <Container>
        <SectionHeading
          eyebrow="Use cases"
          title="Built for the videos you keep meaning to watch"
          description="Lectures, long interviews, conference talks and the occasional two-hour rabbit hole."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          {useCases.map((item, index) => (
            <Reveal key={item.label} delay={(index % 2) * 80}>
              <article className="group flex h-full flex-col gap-6 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.015] p-7 transition-colors duration-300 hover:border-white/16 hover:bg-white/[0.03] sm:p-8">
                <div className="flex items-center gap-1.5">
                  {trackFills[index].map((fill, barIndex) => (
                    <span key={barIndex} className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                      <span
                        className="block h-full rounded-full bg-accent/70"
                        style={{ width: `${fill * 100}%` }}
                      />
                    </span>
                  ))}
                </div>

                <div className="flex flex-1 flex-col gap-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-accent-bright">
                    <Icon name="clock" size={12} />
                    {item.label}
                  </span>
                  <h3 className="text-xl font-semibold tracking-[-0.01em] text-white">
                    {item.title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-ink-300">{item.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[12px] text-ink-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
