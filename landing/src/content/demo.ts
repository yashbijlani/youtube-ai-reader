/**
 * Sample content for the product demonstration mockup.
 * Purely illustrative copy used to show the interface.
 */

export const demo = {
  video: {
    title: "How Great Engineers Think",
    channel: "Systems Weekly",
    meta: "214K views · 1:02:11",
    duration: "1:02:11",
    progress: 0.31,
    elapsed: "19:18",
  },
  overview:
    "Great engineers are defined less by what they know than by how they reason. This talk distils that reasoning into a few repeatable habits you can apply to any system.",
  keyIdeas: [
    "First principle thinking",
    "Feedback loops",
    "Reducing complexity",
    "Building mental models",
  ],
  chapters: [
    { time: "00:00", title: "Introduction" },
    { time: "07:42", title: "First principles" },
    { time: "19:18", title: "Mental models" },
    { time: "34:10", title: "Feedback loops" },
    { time: "51:26", title: "Practical examples" },
  ],
  upNext: [
    { title: "Debugging Systems, Not Code", meta: "Systems Weekly · 48:12" },
    { title: "The Cost of Complexity", meta: "Build Notes · 32:04" },
    { title: "Designing for Feedback", meta: "Systems Weekly · 56:39" },
    { title: "Trade-offs Over Best Practices", meta: "Build Notes · 27:51" },
    { title: "How to Read a Codebase", meta: "Systems Weekly · 41:07" },
  ],
  question: "What are the three most important ideas from this video?",
  answer: {
    intro:
      "The through-line is that good engineering is mostly about how you frame a problem:",
    points: [
      {
        time: "07:42",
        text: "Start from first principles so you reason about the actual problem instead of inherited assumptions.",
      },
      {
        time: "19:18",
        text: "Build durable mental models that let you transfer an understanding from one system to another.",
      },
      {
        time: "34:10",
        text: "Design tight feedback loops so reality corrects your thinking quickly.",
      },
    ],
  },
} as const;
