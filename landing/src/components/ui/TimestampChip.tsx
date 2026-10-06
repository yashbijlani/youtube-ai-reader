import { Icon } from "./Icons";

export function TimestampChip({
  time,
  active = false,
  className = "",
}: {
  time: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-medium tabular-nums ${
        active
          ? "border-accent/40 bg-accent/12 text-accent-bright"
          : "border-white/10 bg-white/[0.04] text-ink-300"
      } ${className}`.trim()}
    >
      <Icon name="clock" size={9} className="opacity-70" />
      {time}
    </span>
  );
}
