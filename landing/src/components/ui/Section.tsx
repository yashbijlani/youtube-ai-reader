import type { ReactNode } from "react";

export function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 py-20 sm:py-28 ${className}`.trim()}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  const alignment =
    align === "center" ? "mx-auto max-w-2xl text-center items-center" : "max-w-2xl text-left";
  return (
    <div className={`flex flex-col gap-4 ${alignment} ${className}`.trim()}>
      {eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-soft-text">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="text-pretty text-base leading-relaxed text-ink-300 sm:text-[17px]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
