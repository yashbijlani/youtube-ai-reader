import { Hero } from "@/components/sections/Hero";
import { ProductDemonstration } from "@/components/sections/ProductDemonstration";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { FeatureGrid } from "@/components/sections/FeatureGrid";
import { UseCases } from "@/components/sections/UseCases";
import { Pricing } from "@/components/sections/Pricing";
import { FAQ } from "@/components/sections/FAQ";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { SITE } from "@/config/site";
import { pricing } from "@/config/pricing";
import { faqs } from "@/content/faqs";

const softwareJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  applicationCategory: "BrowserApplication",
  operatingSystem: "Chrome",
  description: SITE.description,
  url: SITE.url,
  offers: [
    {
      "@type": "Offer",
      name: pricing.free.name,
      price: "0",
      priceCurrency: "INR",
      description: `Up to ${pricing.free.videos} videos per month, up to ${pricing.free.maxDuration} per video.`,
    },
    {
      "@type": "Offer",
      name: pricing.pro.name,
      price: "299",
      priceCurrency: "INR",
      description: `Up to ${pricing.pro.videos} videos per month, up to ${pricing.pro.maxDuration} per video.`,
    },
  ],
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer },
  })),
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <main id="main">
        <Hero />
        <ProductDemonstration />
        <HowItWorks />
        <FeatureGrid />
        <UseCases />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
    </>
  );
}
