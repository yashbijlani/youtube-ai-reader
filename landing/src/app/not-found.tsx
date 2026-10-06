import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[70vh] items-center pt-24">
      <Container className="text-center">
        <p className="font-mono text-sm text-accent-bright">404</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
          This page doesn&apos;t exist.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-ink-300">
          The link may be broken or the page may have moved. Head back to the homepage to keep
          reading.
        </p>
        <div className="mt-8 flex justify-center">
          <Button href="/">
            <Icon name="arrowLeft" size={16} />
            Back to home
          </Button>
        </div>
      </Container>
    </main>
  );
}
