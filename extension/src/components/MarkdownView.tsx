import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";
import { parseTimestamp } from "../lib/format";

interface MarkdownViewProps {
  markdown: string;
  onSeek: (seconds: number) => void;
  className?: string;
}

export function MarkdownView({ markdown, onSeek, className }: MarkdownViewProps) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  return (
    <div
      className={className}
      onClick={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-ts]");
        if (!target?.dataset.ts) return;
        const seconds = parseTimestamp(target.dataset.ts);
        if (seconds != null) onSeek(seconds);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
