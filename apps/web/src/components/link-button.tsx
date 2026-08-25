"use client";

import type { ComponentProps, ReactNode } from "react";
import { buttonVariants } from "@foundathyon/community-ui";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * A navigation that wears the button skin. §09 is explicit that something which
 * navigates is a Link however it looks, and community-ui exposes
 * `buttonVariants` for exactly that.
 *
 * This has to be a client component. `buttonVariants` lives in the library's
 * `actions/button` module, which is marked `"use client"` — so the function
 * itself is a client export, and CALLING it while rendering on the server
 * throws "Attempted to call buttonVariants() from the server". Rendering this
 * component from a server page is fine; invoking the function there is not.
 */
export type LinkButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "destructive-subtle";
export type LinkButtonSize = "xs" | "sm" | "md" | "lg";

export interface LinkButtonProps extends Omit<ComponentProps<"a">, "href"> {
  href: string;
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  /**
   * Leaves the app: renders a plain anchor opening in a new tab instead of the
   * locale-aware router link. Raw file downloads and published drop URLs are
   * served by the Go API, not by Next, so they must not go through the router.
   */
  external?: boolean;
  children?: ReactNode;
}

// The spread goes FIRST everywhere below. `href` and `className` are this
// component's job, and a caller's leftover props must never end up deciding
// where the link points — the same mistake that put `href: undefined` on the
// breadcrumb links.
export function LinkButton({
  href,
  variant = "secondary",
  size = "sm",
  external = false,
  className,
  children,
  ...props
}: LinkButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (external) {
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link {...props} href={href} className={classes}>
      {children}
    </Link>
  );
}
