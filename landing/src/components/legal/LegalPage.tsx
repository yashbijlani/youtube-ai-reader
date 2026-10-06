import type { ReactNode } from "react";
import { Container } from "@/components/ui/Container";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main id="main" className="pt-32 sm:pt-36">
      <Container className="pb-24">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-bright">
            Legal
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-ink-400">Last updated {updated}</p>
          <div className="prose-legal mt-6">{intro}</div>
        </div>

        <div className="mt-14 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <div className="sticky top-24">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                On this page
              </p>
              <ul className="mt-4 flex flex-col gap-2.5 border-l border-white/8 pl-4">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="text-[13px] text-ink-400 transition-colors hover:text-white"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="max-w-3xl">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className={`scroll-mt-24 ${
                  index === 0 ? "" : "mt-10 border-t border-white/8 pt-10"
                }`}
              >
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-white">
                  {section.title}
                </h2>
                <div className="prose-legal mt-3">{section.body}</div>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </main>
  );
}
