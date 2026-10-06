import type { IconName } from "@/components/ui/Icons";

export interface Feature {
  icon: IconName;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: "book",
    title: "Readable overviews",
    description: "Turn long videos into structured, readable explanations.",
  },
  {
    icon: "spark",
    title: "Key ideas",
    description: "Extract the concepts that actually matter.",
  },
  {
    icon: "clock",
    title: "Timestamped answers",
    description: "Jump directly to where an idea was discussed.",
  },
  {
    icon: "chat",
    title: "Ask the video",
    description: "Ask questions and get answers grounded in the video's content.",
  },
  {
    icon: "list",
    title: "Chapters",
    description:
      "Navigate long videos by topic instead of scrubbing through the timeline.",
  },
  {
    icon: "text",
    title: "Transcript access",
    description:
      "Keep the underlying transcript available when you want to inspect the source.",
  },
  {
    icon: "youtube",
    title: "Works inside YouTube",
    description: "Use the experience where you already watch videos.",
  },
  {
    icon: "bolt",
    title: "Fast",
    description: "Get to the useful information without waiting around.",
  },
];
