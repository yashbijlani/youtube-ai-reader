import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { SITE, SUPPORT_EMAIL, supportEmailIsConfigured } from "@/config/site";
import { pricing } from "@/config/pricing";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms that govern your use of YouTube AI Reader, including plans, billing, acceptable use and disclaimers.",
  alternates: { canonical: "/terms" },
  openGraph: { title: "Terms of Service — YouTube AI Reader", url: "/terms" },
};

function ContactLine() {
  if (supportEmailIsConfigured()) {
    return (
      <p>
        Questions about these terms? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
        or use our <a href="/contact">contact page</a>.
      </p>
    );
  }
  return (
    <p>
      Questions about these terms? Use our <a href="/contact">contact page</a>.
    </p>
  );
}

const sections: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance of terms",
    body: (
      <p>
        By installing or using {SITE.name}, you agree to these terms. If you do not agree, please
        do not use the product.
      </p>
    ),
  },
  {
    id: "the-service",
    title: "The service",
    body: (
      <>
        <p>
          {SITE.name} is a Chrome extension that turns YouTube videos into readable, searchable and
          interactive AI experiences. It produces structured overviews, key ideas, chapters,
          transcript access and answers grounded in a video&apos;s available transcript.
        </p>
        <p>
          The product is a reading aid. AI-generated output may be incomplete or inaccurate, and you
          should verify anything important against the source video.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts",
    body: (
      <>
        <p>
          You need an account to use {SITE.name}. You are responsible for keeping your account
          secure and for activity that happens under it. You must provide accurate information and
          be old enough to enter into these terms in your jurisdiction.
        </p>
      </>
    ),
  },
  {
    id: "plans-and-billing",
    title: "Plans and billing",
    body: (
      <>
        <p>We offer a free plan and a paid plan:</p>
        <ul>
          <li>
            <strong>{pricing.free.name}</strong> — {pricing.free.price}, up to {pricing.free.videos}{" "}
            videos per month, up to {pricing.free.maxDuration} per video.
          </li>
          <li>
            <strong>{pricing.pro.name}</strong> — {pricing.pro.price}
            {pricing.pro.period}, up to {pricing.pro.videos} videos per month, up to{" "}
            {pricing.pro.maxDuration} per video.
          </li>
        </ul>
        <p>
          Paid subscriptions are billed through our payment provider and renew on a recurring basis
          until cancelled. Prices are shown in INR and may change; we will make changes clear before
          they take effect.
        </p>
        <p>
          You can cancel at any time. Cancelling stops future renewals, and you keep access for the
          remainder of the period you have already paid for.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>use the product for unlawful purposes or to infringe anyone&apos;s rights;</li>
          <li>attempt to bypass usage limits, quotas or access controls;</li>
          <li>reverse engineer, resell or redistribute the product without permission; or</li>
          <li>interfere with or disrupt the service or its infrastructure.</li>
        </ul>
      </>
    ),
  },
  {
    id: "third-party-content",
    title: "Third-party content and YouTube",
    body: (
      <>
        <p>
          {SITE.name} works alongside YouTube and processes content that is owned by others. You
          are responsible for using it in accordance with YouTube&apos;s own terms and any
          applicable rights. {SITE.name} is not affiliated with, endorsed by, or sponsored by
          YouTube or Google.
        </p>
      </>
    ),
  },
  {
    id: "intellectual-property",
    title: "Intellectual property",
    body: (
      <p>
        The {SITE.name} name, interface and software are owned by their respective rights holders.
        These terms do not grant you any right to our brand or to use the product beyond what is
        described here.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <p>
        We work to keep the service available and dependable, but we do not guarantee uninterrupted
        access. We may add, change or remove features, and may suspend or discontinue the service,
        with reasonable notice where practical.
      </p>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        The service is provided “as is” and “as available”, without warranties of any kind, whether
        express or implied, including fitness for a particular purpose and non-infringement. AI
        output is not professional, legal, financial or medical advice.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <p>
        To the maximum extent permitted by law, we are not liable for indirect, incidental, special
        or consequential damages, or for lost data or profits, arising from your use of the
        service. Where liability cannot be excluded, it is limited to the amount you paid for the
        service in the period preceding the claim.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of the jurisdiction in which the operator of{" "}
        {SITE.name} is established, without regard to conflict-of-law rules. Any disputes will be
        handled by the competent courts of that jurisdiction.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: <ContactLine />,
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 6, 2026"
      intro={
        <p>
          These terms explain the agreement between you and {SITE.name} when you use the extension,
          the website and related services.
        </p>
      }
      sections={sections}
    />
  );
}
