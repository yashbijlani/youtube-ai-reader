import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { pricing, type Plan } from "@/config/pricing";
import { appHref, chromeStoreHref } from "@/config/site";

const plans: Plan[] = [pricing.free, pricing.pro];

export function Pricing() {
  return (
    <Section id="pricing" className="border-t border-white/8">
      <Container>
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Upgrade when YouTube becomes your second brain."
          description="Simple monthly pricing. No hidden tiers, no fake discounts, no “unlimited”."
        />

        <div className="mx-auto mt-14 grid max-w-4xl gap-4 md:grid-cols-2">
          {plans.map((plan, index) => (
            <Reveal key={plan.id} delay={index * 80}>
              <article
                className={`relative flex h-full flex-col rounded-3xl border p-7 sm:p-8 ${
                  plan.highlighted
                    ? "border-accent/40 bg-gradient-to-b from-accent/[0.07] to-transparent"
                    : "border-white/10 bg-white/[0.015]"
                }`}
              >
                <div
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-x-0 top-0 h-px ${
                    plan.highlighted
                      ? "bg-gradient-to-r from-transparent via-accent to-transparent"
                      : "bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  }`}
                />

                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-white">{plan.name}</h3>
                  {plan.badge ? (
                    <span className="rounded-full border border-accent/30 bg-accent/12 px-2.5 py-1 text-[11px] font-medium text-accent-bright">
                      {plan.badge}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 flex items-end gap-1.5">
                  <span className="text-4xl font-semibold tracking-[-0.03em] text-white">
                    {plan.price}
                  </span>
                  {plan.period ? (
                    <span className="pb-1 text-sm text-ink-400">{plan.period}</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-ink-400">{plan.priceNote}</p>

                <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8">
                  <div className="bg-ink-950 px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
                      Videos / month
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-white">{plan.videos}</dd>
                  </div>
                  <div className="bg-ink-950 px-4 py-3.5">
                    <dt className="text-[11px] uppercase tracking-[0.12em] text-ink-400">
                      Per video
                    </dt>
                    <dd className="mt-1 text-lg font-semibold text-white">{plan.maxDuration}</dd>
                  </div>
                </dl>

                <ul className="mt-6 flex flex-1 flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[14.5px] text-ink-200">
                      <Icon
                        name="check"
                        size={16}
                        className="mt-0.5 flex-none text-accent-bright"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  <Button
                    href={plan.highlighted ? appHref() : chromeStoreHref}
                    variant={plan.highlighted ? "primary" : "secondary"}
                    size="lg"
                    className="w-full"
                  >
                    {plan.cta}
                  </Button>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] text-ink-400">
          Prices in INR. Cancel anytime. Payments are processed securely by our payment
          provider — no card details ever reach this website.
        </p>
      </Container>
    </Section>
  );
}
