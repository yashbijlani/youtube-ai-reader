import Link from "next/link";
import { BrandMark, Icon } from "@/components/ui/Icons";
import { Container } from "@/components/ui/Container";
import { SITE, appHref, chromeStoreHref, supportEmailIsConfigured, SUPPORT_EMAIL } from "@/config/site";

const productLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
];

const legalLinks = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/8 bg-ink-950">
      <Container className="py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold text-white">
              <BrandMark size={26} />
              <span>{SITE.name}</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-ink-300">{SITE.tagline}</p>
            <a
              href={appHref()}
              className="mt-6 inline-flex items-center gap-2 text-sm text-ink-300 transition-colors hover:text-white"
            >
              <Icon name="user" size={15} />
              Sign in
            </a>
          </div>

          <FooterColumn title="Product">
            {productLinks.map((link) => (
              <FooterLink key={link.href} href={link.href}>
                {link.label}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Legal">
            {legalLinks.map((link) => (
              <FooterLink key={link.href} href={link.href}>
                {link.label}
              </FooterLink>
            ))}
          </FooterColumn>

          <FooterColumn title="Support">
            <FooterLink href="/contact">Contact</FooterLink>
            {supportEmailIsConfigured() ? (
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-white"
              >
                <Icon name="mail" size={14} />
                {SUPPORT_EMAIL}
              </a>
            ) : null}
            <a
              href={chromeStoreHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-ink-400 transition-colors hover:text-white"
            >
              <Icon name="youtube" size={14} />
              Chrome Web Store
            </a>
          </FooterColumn>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/8 pt-6 text-sm text-ink-400 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {SITE.name}</p>
          <p className="text-ink-500">Not affiliated with or endorsed by YouTube or Google.</p>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-500">{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-sm text-ink-300 transition-colors hover:text-white"
      >
        {children}
      </Link>
    </li>
  );
}
