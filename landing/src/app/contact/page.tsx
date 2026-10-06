import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon, type IconName } from "@/components/ui/Icons";
import {
  SUPPORT_EMAIL,
  appHref,
  chromeStoreHref,
  supportEmailIsConfigured,
} from "@/config/site";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact YouTube AI Reader for support, billing and product questions, or find the Chrome Web Store listing.",
  alternates: { canonical: "/contact" },
  openGraph: { title: "Contact — YouTube AI Reader", url: "/contact" },
};

const helpTopics = [
  "Which browser and extension version you are using",
  "The YouTube video or page where the issue happened",
  "What you expected to happen, and what happened instead",
];

export default function ContactPage() {
  const emailConfigured = supportEmailIsConfigured();

  return (
    <main id="main" className="pt-32 sm:pt-36">
      <Container className="pb-24">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-bright">
            Support
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
            Contact
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-300">
            Questions about the extension, your plan or billing? We&apos;d like to help. Reach us
            using any of the options below.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2">
          <ContactCard
            icon="mail"
            title="Email support"
            description="Best for account, billing and technical questions."
          >
            {emailConfigured ? (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-2 text-[15px] font-medium text-accent-bright underline-offset-4 hover:underline"
              >
                <Icon name="mail" size={15} />
                {SUPPORT_EMAIL}
              </a>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="inline-flex w-fit items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[13px] text-ink-200">
                  {SUPPORT_EMAIL}
                </span>
                <span className="text-[12.5px] text-ink-400">
                  Support address not yet configured.
                </span>
              </div>
            )}
          </ContactCard>

          <ContactCard
            icon="youtube"
            title="Chrome Web Store"
            description="Install the extension, and find the listing page."
          >
            <a
              href={chromeStoreHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[15px] font-medium text-accent-bright underline-offset-4 hover:underline"
            >
              <Icon name="arrowUpRight" size={15} />
              Open Chrome Web Store
            </a>
          </ContactCard>

          <ContactCard
            icon="user"
            title="Account & sign in"
            description="Sign in and manage your plan from the app."
          >
            <a
              href={appHref()}
              className="inline-flex items-center gap-2 text-[15px] font-medium text-accent-bright underline-offset-4 hover:underline"
            >
              <Icon name="arrowRight" size={15} />
              Go to sign in
            </a>
          </ContactCard>

          <ContactCard
            icon="card"
            title="Plans & billing"
            description="See what each plan includes and how limits work."
          >
            <Link
              href="/#pricing"
              className="inline-flex items-center gap-2 text-[15px] font-medium text-accent-bright underline-offset-4 hover:underline"
            >
              <Icon name="arrowRight" size={15} />
              View pricing
            </Link>
          </ContactCard>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/8 bg-white/[0.015] p-7">
            <h2 className="text-base font-semibold text-white">When you write in</h2>
            <p className="mt-2 text-sm text-ink-300">
              Including these details helps us resolve things faster:
            </p>
            <ul className="mt-5 flex flex-col gap-3">
              {helpTopics.map((topic) => (
                <li key={topic} className="flex items-start gap-2.5 text-sm text-ink-200">
                  <Icon name="check" size={16} className="mt-0.5 flex-none text-accent-bright" />
                  {topic}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col justify-between gap-6 rounded-2xl border border-white/8 bg-white/[0.015] p-7">
            <div>
              <h2 className="text-base font-semibold text-white">Legal documents</h2>
              <p className="mt-2 text-sm text-ink-300">
                Read how we handle your data and the terms of the service.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/privacy"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-ink-100 transition-colors hover:border-white/20 hover:text-white"
                >
                  <Icon name="shield" size={15} />
                  Privacy Policy
                </Link>
                <Link
                  href="/terms"
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-ink-100 transition-colors hover:border-white/20 hover:text-white"
                >
                  <Icon name="text" size={15} />
                  Terms of Service
                </Link>
              </div>
            </div>

            <Button href={chromeStoreHref} className="w-full sm:w-fit">
              <Icon name="spark" size={16} />
              Add to Chrome
            </Button>
          </div>
        </div>
      </Container>
    </main>
  );
}

function ContactCard({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.015] p-6 sm:p-7">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.03] text-ink-200">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-ink-300">{description}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}
