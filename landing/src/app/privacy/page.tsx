import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/legal/LegalPage";
import { SITE, SUPPORT_EMAIL, supportEmailIsConfigured } from "@/config/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How YouTube AI Reader handles your account information, video and transcript processing, AI processing, usage data and payment information.",
  alternates: { canonical: "/privacy" },
  openGraph: { title: "Privacy Policy — YouTube AI Reader", url: "/privacy" },
};

function ContactLine() {
  if (supportEmailIsConfigured()) {
    return (
      <p>
        Questions about this policy? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> or use our{" "}
        <a href="/contact">contact page</a>.
      </p>
    );
  }
  return (
    <p>
      Questions about this policy? Use our <a href="/contact">contact page</a>.
    </p>
  );
}

const sections: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    body: (
      <>
        <p>
          This policy explains what information {SITE.name} collects, why we collect it, and the
          choices you have. {SITE.name} is a Chrome extension that turns YouTube videos into
          readable, searchable and interactive AI experiences.
        </p>
        <p>
          We keep data collection to what is needed to run the product: an account, the videos you
          choose to process, and basic usage information.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Account information",
    body: (
      <>
        <p>
          You need an account to use the product. When you sign in, we receive and store the
          account details provided by our authentication provider, typically your email address and
          an internal user identifier. We use this to authenticate you, track usage against your
          plan, and grant access to paid features.
        </p>
        <p>We do not store your authentication password.</p>
      </>
    ),
  },
  {
    id: "video-and-transcript",
    title: "Video and transcript processing",
    body: (
      <>
        <p>
          When you ask {SITE.name} to read a video, the extension retrieves the video&apos;s
          available transcript (captions) so it can generate a reading guide and answer questions.
        </p>
        <ul>
          <li>
            Transcripts may be fetched from YouTube in your browser or through a server-side
            fallback on validated YouTube video identifiers.
          </li>
          <li>
            We store the transcript and generated analysis so the same video does not need to be
            reprocessed, which reduces cost and improves speed.
          </li>
          <li>
            Video content and transcripts are processed to provide the features you request; they
            are not sold or used for advertising.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "ai-processing",
    title: "AI processing",
    body: (
      <>
        <p>
          To generate overviews, key ideas, chapters and answers, the relevant transcript text and
          your questions are sent to a third-party AI model provider for processing. The AI outputs
          are generated from the available transcript; they may be incomplete or inaccurate and
          should be treated as a reading aid rather than a verbatim record.
        </p>
      </>
    ),
  },
  {
    id: "usage",
    title: "Usage information",
    body: (
      <>
        <p>
          We record product usage needed to operate your plan and keep the service reliable,
          including:
        </p>
        <ul>
          <li>how many videos you have processed and against which monthly limit;</li>
          <li>your subscription status;</li>
          <li>basic technical and diagnostic information related to requests.</li>
        </ul>
      </>
    ),
  },
  {
    id: "payments",
    title: "Payment information",
    body: (
      <>
        <p>
          Paid subscriptions are handled by our payment provider. Payments are processed through
          the provider&apos;s secure checkout; we do not receive or store your full card details.
          We store the subscription status and limited transaction references needed to keep your
          account up to date.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <p>
          The website is largely static and does not require cookies for you to read it. The
          extension and app may use browser local storage (and similar mechanisms) to keep you
          signed in, remember settings, and cache data locally, such as per-video conversations.
          This local data lives on your device.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <>
        <p>
          We rely on third-party providers to operate the service. Depending on how you use the
          product, these include:
        </p>
        <ul>
          <li>cloud hosting for the backend service;</li>
          <li>an authentication and database provider for accounts and stored data;</li>
          <li>an AI model provider for generating reading guides and answers; and</li>
          <li>a payment provider for subscription billing.</li>
        </ul>
        <p>
          These providers process information on our behalf and are subject to their own privacy
          terms.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    body: (
      <>
        <p>
          We retain account and usage information for as long as your account is active and as
          needed to operate the service. Shared video analyses may be retained to serve the
          product efficiently. We delete or anonymise data when it is no longer needed, or when you
          ask us to, subject to legal or operational requirements.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>access the personal information we hold about you;</li>
          <li>request correction or deletion of that information;</li>
          <li>object to or restrict certain processing; and</li>
          <li>withdraw consent where processing is based on consent.</li>
        </ul>
        <p>
          To make a request, contact us using the details below. We may need to verify your
          identity before acting on a request.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <>
        <p>
          We may update this policy from time to time. When we make material changes we will update
          the “last updated” date above and, where appropriate, provide additional notice.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: <ContactLine />,
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 6, 2026"
      intro={
        <p>
          {SITE.name} is built to be useful without being invasive. This policy describes the
          information we handle when you use the extension, the website and related services.
        </p>
      }
      sections={sections}
    />
  );
}
