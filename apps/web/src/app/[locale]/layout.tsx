import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { FoundathyonProvider, ThemeScript, ToastProvider, TooltipProvider } from "@foundathyon/community-ui";
import { ACCENT_INIT_SCRIPT, DEFAULT_ACCENT } from "@/lib/accents";
import { routing } from "@/i18n/routing";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Drop is not one of the five Community products, so it has no
// `data-fdn-product` preset and declares its own accent instead (§02: a
// product is a hue, not a hex). It arrives via `data-accent` on <html> rather
// than FoundathyonProvider's `accent` prop, for one concrete reason: that prop
// sets the variables as INLINE STYLES, and inline styles outrank the
// `[data-accent="…"]` rules in globals.css — which would leave the palette
// picker unable to change anything. The attribute keeps one source of truth
// (the CSS), still renders server-side with no flash, and is exactly what the
// picker and the init script below already write.

export const metadata: Metadata = {
  title: "Drop admin",
  description: "Panel de administración de Drop.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      data-accent={DEFAULT_ACCENT}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript defaultTheme="system" />
        {/* Same job as ThemeScript, for the accent: apply the stored choice
            before the first paint instead of after hydration. Only the picker
            ever writes that value, and the picker only exists outside
            production — in a production build this reads an empty key and the
            server-rendered accent above stands. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-bg text-text">
        <NextIntlClientProvider>
          <FoundathyonProvider defaultTheme="system">
            <TooltipProvider>
              <ToastProvider>{children}</ToastProvider>
            </TooltipProvider>
          </FoundathyonProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
