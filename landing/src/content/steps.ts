export interface Step {
  index: string;
  title: string;
  description: string;
}

export const steps: Step[] = [
  {
    index: "01",
    title: "Open YouTube",
    description: "Find a video you want to understand.",
  },
  {
    index: "02",
    title: "Read with AI",
    description:
      "Open YouTube AI Reader and get a structured overview, key ideas, and chapters.",
  },
  {
    index: "03",
    title: "Ask anything",
    description:
      "Ask questions about the video and jump directly to the relevant moment.",
  },
];
