import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { faqs } from "@/content/faqs";

export function FAQ() {
  return (
    <Section id="faq" className="border-t border-white/8">
      <Container width="narrow">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />

        <div className="mt-12 border-y border-white/8">
          {faqs.map((faq, index) => (
            <Reveal key={faq.question} delay={index * 30}>
              <details className="group border-b border-white/8 last:border-b-0">
                <summary className="flex list-none cursor-pointer items-center justify-between gap-4 py-5 text-left text-[15.5px] font-medium text-white transition-colors hover:text-accent-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-4 focus-visible:ring-offset-ink-950 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <Icon
                    name="chevron"
                    size={18}
                    className="flex-none text-ink-400 transition-transform duration-300 group-open:rotate-180 group-open:text-accent-bright"
                  />
                </summary>
                <div className="pb-5 pr-6 text-[15px] leading-relaxed text-ink-300">
                  {faq.answer}
                </div>
              </details>
            </Reveal>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-ink-400">
          Still have a question?{" "}
          <Link href="/contact" className="text-accent-bright underline-offset-4 hover:underline">
            Get in touch
          </Link>
          .
        </p>
      </Container>
    </Section>
  );
}
