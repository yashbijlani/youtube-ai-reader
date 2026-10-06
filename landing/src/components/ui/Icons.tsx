import type { SVGProps } from "react";

export type IconName =
  | "spark"
  | "book"
  | "clock"
  | "chat"
  | "list"
  | "text"
  | "youtube"
  | "bolt"
  | "check"
  | "chevron"
  | "arrowRight"
  | "arrowLeft"
  | "arrowUpRight"
  | "menu"
  | "close"
  | "refresh"
  | "play"
  | "mail"
  | "shield"
  | "lock"
  | "card"
  | "cookie"
  | "database"
  | "settings"
  | "user"
  | "eye";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const icons: Record<IconName, (props: IconProps) => React.ReactElement> = {
  spark: (props) => (
    <Svg {...props}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" stroke="none" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" stroke="none" opacity={0.65} />
    </Svg>
  ),
  book: (props) => (
    <Svg {...props}>
      <path d="M2 4.5h6.5A3.5 3.5 0 0 1 12 8v12a2.5 2.5 0 0 0-2.5-2.5H2z" />
      <path d="M22 4.5h-6.5A3.5 3.5 0 0 0 12 8v12a2.5 2.5 0 0 1 2.5-2.5H22z" />
    </Svg>
  ),
  clock: (props) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  chat: (props) => (
    <Svg {...props}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z" />
    </Svg>
  ),
  list: (props) => (
    <Svg {...props}>
      <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
      <circle cx="4" cy="6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  text: (props) => (
    <Svg {...props}>
      <path d="M4 6.5h16M4 11.5h16M4 16.5h9" />
    </Svg>
  ),
  youtube: (props) => (
    <Svg {...props}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.6l4.8 2.4L10 14.4z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  bolt: (props) => (
    <Svg {...props}>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z" />
    </Svg>
  ),
  check: (props) => (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  chevron: (props) => (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  ),
  arrowRight: (props) => (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  arrowUpRight: (props) => (
    <Svg {...props}>
      <path d="M7 17 17 7M8.5 7H17v8.5" />
    </Svg>
  ),
  arrowLeft: (props) => (
    <Svg {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  ),
  menu: (props) => (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
  close: (props) => (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  refresh: (props) => (
    <Svg {...props}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 4v5h-5" />
    </Svg>
  ),
  play: (props) => (
    <Svg {...props}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  mail: (props) => (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </Svg>
  ),
  shield: (props) => (
    <Svg {...props}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.7 7 9.5 4.1-1.8 7-5.2 7-9.5V6z" />
    </Svg>
  ),
  lock: (props) => (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  ),
  card: (props) => (
    <Svg {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="M2.5 9.5h19" />
    </Svg>
  ),
  cookie: (props) => (
    <Svg {...props}>
      <path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 0-4-4z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </Svg>
  ),
  database: (props) => (
    <Svg {...props}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </Svg>
  ),
  settings: (props) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.18V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 7.5 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6.1 9.9l-.06-.06A2 2 0 1 1 8.87 7l.06.06A1.65 1.65 0 0 0 11 7.4V7.3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 17.9 9.9l.06-.06A2 2 0 1 1 20.8 12.7l-.06.06a1.65 1.65 0 0 0-.34 1.24z" />
    </Svg>
  ),
  user: (props) => (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  ),
  eye: (props) => (
    <Svg {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & IconProps) {
  const Component = icons[name];
  return <Component {...props} />;
}

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="url(#brand-grad)" />
      <path
        d="M10 21.5V10.5L22 16z"
        fill="white"
        opacity="0.92"
      />
      <path
        d="M21.5 8.5l.75 2.05L24.3 11.3l-2.05.75-.75 2.05-.75-2.05L18.7 11.3l2.05-.75z"
        fill="white"
      />
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF6B6B" />
          <stop offset="1" stopColor="#C62A2A" />
        </linearGradient>
      </defs>
    </svg>
  );
}
