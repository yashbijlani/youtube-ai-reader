import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { ProductMockup } from "@/components/ProductMockup";
import { chromeStoreHref } from "@/config/site";

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-32 sm:pb-24 sm:pt-40">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px]"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 0%, rgba(242,85,90,0.18), transparent 72%)",
        }}
      />
      <div aria-hidden="true" className="grid-bg pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] opacity-[0.5] [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]" />

      <Container className="flex flex-col items-center text-center">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[12.5px] text-ink-200 opacity-0 [animation:rise_0.6s_cubic-bezier(0.16,1,0.3,1)_both]"
          style={{ animationDelay: "40ms" }}
        >
          <Icon name="youtube" size={15} className="text-accent-bright" />
          Chrome extension · Works directly on YouTube
        </span>

        <h1
          className="mt-6 max-w-4xl text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white opacity-0 [animation:rise_0.7s_cubic-bezier(0.16,1,0.3,1)_both] sm:text-5xl lg:text-6xl"
          style={{ animationDelay: "100ms" }}
        >
          Turn YouTube into something you can read, search, and{" "}
          <span className="relative whitespace-nowrap">
            talk to
            <span
              aria-hidden="true"
              className="absolute -bottom-1 left-0 h-[2px] w-full bg-gradient-to-r from-accent to-transparent"
            />
          </span>
          .
        </h1>

        <p
          className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-ink-300 opacity-0 [animation:rise_0.7s_cubic-bezier(0.16,1,0.3,1)_both] sm:text-[17px]"
          style={{ animationDelay: "160ms" }}
        >
          Read long videos as structured articles, jump to the exact moment something was
          said, and ask AI questions grounded in the video.
        </p>

        <div
          className="mt-9 flex flex-col items-center gap-3 opacity-0 [animation:rise_0.7s_cubic-bezier(0.16,1,0.3,1)_both] sm:flex-row"
          style={{ animationDelay: "220ms" }}
        >
          <Button href={chromeStoreHref} size="lg" className="w-full sm:w-auto">
            <Icon name="spark" size={16} />
            Add to Chrome
          </Button>
          <Button href="/#how-it-works" variant="secondary" size="lg" className="w-full sm:w-auto">
            See how it works
          </Button>
        </div>

        <p
          className="mt-5 inline-flex items-center gap-2 text-[13px] text-ink-400 opacity-0 [animation:rise_0.7s_cubic-bezier(0.16,1,0.3,1)_both]"
          style={{ animationDelay: "280ms" }}
        >
          <Icon name="check" size={14} className="text-accent-bright" />
          Free to try · No credit card required
        </p>

        <div
          className="mt-16 w-full max-w-5xl opacity-0 [animation:rise_0.9s_cubic-bezier(0.16,1,0.3,1)_both] sm:mt-20"
          style={{ animationDelay: "320ms" }}
        >
          <ProductMockup />
        </div>
      </Container>
    </section>
  );
}
