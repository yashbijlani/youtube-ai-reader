import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { chromeStoreHref } from "@/config/site";

export function FinalCTA() {
  return (
    <section className="border-t border-white/8 py-20 sm:py-28">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 70% at 50% 0%, rgba(242,85,90,0.2), transparent 70%)",
            }}
          />
          <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_70%_at_50%_0%,black,transparent)]" />

          <div className="relative flex flex-col items-center">
            <h2 className="max-w-2xl text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl lg:text-5xl">
              Stop scrubbing through the timeline.
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-ink-300 sm:text-[17px]">
              Turn your next YouTube rabbit hole into something you can actually understand.
            </p>

            <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
              <Button href={chromeStoreHref} size="lg" className="w-full sm:w-auto">
                <Icon name="spark" size={16} />
                Add to Chrome
              </Button>
              <Button href="/#pricing" variant="secondary" size="lg" className="w-full sm:w-auto">
                View pricing
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
