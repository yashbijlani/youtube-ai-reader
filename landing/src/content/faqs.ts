export interface Faq {
  question: string;
  answer: string;
}

export const faqs: Faq[] = [
  {
    question: "What is YouTube AI Reader?",
    answer:
      "A Chrome extension that turns YouTube videos into readable, searchable and interactive AI experiences.",
  },
  {
    question: "Does it work with long videos?",
    answer:
      "Yes. Video length depends on your plan. Free supports videos up to 60 minutes and Pro supports videos up to 3 hours.",
  },
  {
    question: "Can I ask questions about a video?",
    answer:
      "Yes. Ask questions about the video's content and get answers grounded in the available transcript.",
  },
  {
    question: "Does it work directly on YouTube?",
    answer:
      "Yes. YouTube AI Reader is designed as a Chrome extension that works alongside YouTube.",
  },
  {
    question: "Is there a free plan?",
    answer: "Yes. You can process up to 3 videos per month for free.",
  },
  {
    question: "How much does Pro cost?",
    answer: "₹299/month.",
  },
  {
    question: "Do I need an account?",
    answer: "An account is required for usage tracking and Pro access.",
  },
  {
    question: "Can I cancel Pro?",
    answer: "Yes.",
  },
];
