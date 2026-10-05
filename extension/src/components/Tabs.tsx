import type { ReactElement } from "react";
import type { TabId } from "../types";
import { BookIcon, ChatIcon } from "./Icons";

interface TabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  counts: { chat: number };
}

const TABS: Array<{ id: TabId; label: string; icon: (props: { size?: number }) => ReactElement }> = [
  { id: "overview", label: "Overview", icon: BookIcon },
  { id: "chat", label: "Ask", icon: ChatIcon },
];

export function Tabs({ active, onChange, counts }: TabsProps) {
  return (
    <nav className="tabs" role="tablist" aria-label="Reader sections">
      {TABS.map((tab) => {
        const count = tab.id === "chat" ? counts.chat : 0;
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
