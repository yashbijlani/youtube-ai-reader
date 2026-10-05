import { formatTimestamp } from "../lib/format";
import { ClockIcon } from "./Icons";

interface TimestampChipProps {
  seconds: number | null | undefined;
  onSeek: (seconds: number) => void;
  className?: string;
  showIcon?: boolean;
}

export function TimestampChip({ seconds, onSeek, className, showIcon = true }: TimestampChipProps) {
  if (seconds == null) return null;
  return (
    <button
      type="button"
      className={`ts-chip${className ? ` ${className}` : ""}`}
      title={`Jump the video to ${formatTimestamp(seconds)}`}
      onClick={(event) => {
        event.stopPropagation();
        onSeek(seconds);
      }}
    >
      {showIcon && <ClockIcon size={10} />}
      {formatTimestamp(seconds)}
    </button>
  );
}
