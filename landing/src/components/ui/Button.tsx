import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

interface ActionProps {
  children: ReactNode;
  href?: string;
  external?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-haspopup"?: boolean | "menu" | "dialog";
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap " +
  "transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_0_0_rgba(255,255,255,0.14)_inset,0_8px_24px_-12px_rgba(242,85,90,0.9)] " +
    "hover:bg-accent-strong hover:-translate-y-px active:translate-y-0",
  secondary:
    "border border-white/12 bg-white/[0.035] text-ink-50 hover:border-white/20 hover:bg-white/[0.07]",
  ghost: "text-ink-200 hover:text-white hover:bg-white/[0.06]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();
}

export function Button({
  children,
  href,
  external,
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ActionProps) {
  const classes = buttonClasses({ variant, size, className });

  if (href !== undefined) {
    const isExternal = external ?? /^(https?:)?\/\//.test(href);
    if (isExternal) {
      return (
        <a
          href={href}
          className={classes}
          target={rest.target ?? "_blank"}
          rel={rest.rel ?? "noopener noreferrer"}
          title={rest.title}
          onClick={rest.onClick as MouseEventHandler<HTMLAnchorElement>}
          aria-label={rest["aria-label"]}
        >
          {children}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className={classes}
        title={rest.title}
        target={rest.target}
        rel={rest.rel}
        onClick={rest.onClick as MouseEventHandler<HTMLAnchorElement>}
        aria-label={rest["aria-label"]}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={rest.type ?? "button"}
      className={classes}
      title={rest.title}
      disabled={rest.disabled}
      onClick={rest.onClick as MouseEventHandler<HTMLButtonElement>}
      aria-label={rest["aria-label"]}
      aria-expanded={rest["aria-expanded"]}
      aria-controls={rest["aria-controls"]}
      aria-haspopup={rest["aria-haspopup"]}
    >
      {children}
    </button>
  );
}
