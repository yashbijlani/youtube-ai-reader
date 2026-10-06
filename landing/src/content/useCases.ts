export interface UseCase {
  label: string;
  title: string;
  description: string;
  tags: string[];
}

export const useCases: UseCase[] = [
  {
    label: "Learn faster",
    title: "Turn a lecture into notes",
    description:
      "Read the structure of a lecture, tutorial or technical talk before you sit through it.",
    tags: ["Lectures", "Tutorials", "Technical talks", "Education"],
  },
  {
    label: "Research",
    title: "Get through the long conversation",
    description:
      "Pull the ideas and the exact moments out of interviews, podcasts and debates.",
    tags: ["Interviews", "Podcasts", "Debates", "Expert discussions"],
  },
  {
    label: "Work",
    title: "Stay current without the watch time",
    description:
      "Scan industry talks, product demos and conference sessions for what's relevant to you.",
    tags: ["Industry talks", "Product demos", "Conferences", "Business"],
  },
  {
    label: "Rabbit holes",
    title: "Decide if it's worth every minute",
    description:
      "Understand a two-hour video well enough to know which parts you actually want to watch.",
    tags: ["Long-form", "Deep dives", "Before you commit"],
  },
];
