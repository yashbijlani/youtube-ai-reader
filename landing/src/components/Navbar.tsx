"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { BrandMark, Icon } from "@/components/ui/Icons";
import { appHref, chromeStoreHref, NAV_LINKS } from "@/config/site";

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || open
          ? "border-b border-white/8 bg-ink-950/80 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-5 sm:px-8"
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2 text-[15px] font-semibold tracking-[-0.01em] text-white"
          onClick={() => setOpen(false)}
        >
          <BrandMark size={26} />
          <span>YouTube AI Reader</span>
        </Link>

        <ul className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-full px-3.5 py-2 text-sm text-ink-300 transition-colors hover:bg-white/[0.05] hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href={appHref()}
            className="hidden rounded-full px-3.5 py-2 text-sm text-ink-300 transition-colors hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <span className="hidden sm:block">
            <Button href={chromeStoreHref} size="sm">
              <Icon name="spark" size={15} />
              Add to Chrome
            </Button>
          </span>

          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-200 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "close" : "menu"} size={20} />
          </button>
        </div>
      </nav>

      {open ? (
        <div id="mobile-menu" className="border-t border-white/8 bg-ink-950/95 backdrop-blur-xl lg:hidden">
          <ul className="mx-auto flex w-full max-w-6xl flex-col px-5 py-3 sm:px-8">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="block rounded-lg px-3 py-3 text-[15px] text-ink-200 transition-colors hover:bg-white/[0.05] hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="mt-2 flex flex-col gap-2 px-1 pb-2">
              <Link
                href={appHref()}
                className="rounded-lg px-3 py-3 text-[15px] text-ink-200 transition-colors hover:bg-white/[0.05] hover:text-white"
                onClick={() => setOpen(false)}
              >
                Sign in
              </Link>
              <Button href={chromeStoreHref} size="md" className="w-full">
                <Icon name="spark" size={15} />
                Add to Chrome
              </Button>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  );
}
