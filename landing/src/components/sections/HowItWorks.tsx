import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { steps } from "@/content/steps";

export function HowItWorks() {
  return (
    <Section id="how-it-works" className="border-t border-white/8">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="Three steps from video to understanding"
          description="No setup, no new app to learn. Open a video and start reading."
        />

        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 md:grid-cols-3">
          {steps.map((step, index) => (
            <Reveal as="li" key={step.index} delay={index * 80} className="bg-ink-950">
              <div className="flex h-full flex-col gap-4 p-7 sm:p-8">
                <span className="font-mono text-sm font-medium text-accent-bright">
                  {step.index}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-300">{step.description}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
