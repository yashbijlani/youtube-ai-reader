import type { ReactElement } from "react";
import type { TabId } from "../types";
import { BookIcon, ChatIcon, ListIcon, TextIcon } from "./Icons";

interface TabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  counts: { chapters: number; transcript: number; chat: number };
}

const TABS: Array<{ id: TabId; label: string; icon: (props: { size?: number }) => ReactElement }> = [
  { id: "overview", label: "Overview", icon: BookIcon },
  { id: "chapters", label: "Chapters", icon: ListIcon },
  { id: "transcript", label: "Transcript", icon: TextIcon },
  { id: "chat", label: "Chat", icon: ChatIcon },
];

export function Tabs({ active, onChange, counts }: TabsProps) {
  return (
    <nav className="tabs" role="tablist" aria-label="Reader sections">
      {TABS.map((tab) => {
        const count =
          tab.id === "chapters"
            ? counts.chapters
            : tab.id === "transcript"
              ? counts.transcript
              : tab.id === "chat"
                ? counts.chat
                : 0;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className="tab"
            onClick={() => onChange(tab.id)}
          >
            <Icon size={13} />
            {tab.label}
            {count > 0 ? <span className="count">{count > 999 ? "999+" : count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
