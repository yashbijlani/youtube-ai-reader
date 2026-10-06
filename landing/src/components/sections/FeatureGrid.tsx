import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { features } from "@/content/features";

export function FeatureGrid() {
  return (
    <Section id="features" className="border-t border-white/8">
      <Container>
        <SectionHeading
          eyebrow="Features"
          title="Read it. Search it. Ask it."
          description="Everything is built around one idea: interact with the knowledge in a video instead of just watching it."
        />

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={(index % 4) * 60} className="group bg-ink-950">
              <div className="flex h-full flex-col gap-4 p-6 transition-colors duration-300 group-hover:bg-white/[0.02]">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-ink-200 transition-colors group-hover:border-accent/30 group-hover:text-accent-bright">
                  <Icon name={feature.icon} size={19} />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-[15px] font-semibold text-white">{feature.title}</h3>
                  <p className="text-sm leading-relaxed text-ink-300">{feature.description}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}
