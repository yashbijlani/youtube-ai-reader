/**
 * Single source of truth for pricing.
 *
 * Change prices, limits or feature lists here — nothing is hardcoded in JSX.
 */

export interface Plan {
  id: "free" | "pro";
  name: string;
  price: string;
  period: string;
  priceNote: string;
  videos: number;
  maxDuration: string;
  summary: string;
  cta: string;
  highlighted: boolean;
  badge?: string;
  features: string[];
}

export const pricing: Record<"free" | "pro", Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: "₹0",
    period: "",
    priceNote: "Free to try · no credit card required",
    videos: 3,
    maxDuration: "60 minutes",
    summary: "Everything you need to read your first few videos.",
    cta: "Get started",
    highlighted: false,
    features: [
      "AI overview",
      "Key ideas",
      "Chapters",
      "Ask questions",
      "Timestamped answers",
      "Transcript access",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: "₹299",
    period: "/ month",
    priceNote: "Cancel anytime",
    videos: 50,
    maxDuration: "3 hours",
    summary: "For people who use YouTube as a second brain.",
    cta: "Get Pro",
    highlighted: true,
    badge: "Most complete",
    features: [
      "Everything in Free",
      "Longer videos",
      "Higher monthly limit",
      "Saved history",
      "Priority processing",
    ],
  },
};

export const proPriceLabel = `${pricing.pro.price}${pricing.pro.period}`;
