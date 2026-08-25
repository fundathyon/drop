import { Check, Package } from "lucide-react";
import { useTranslations } from "next-intl";

// The left brand panel of the first-run screens (login, setup, invitation),
// ported from dokgistry's components/BrandPanel.tsx so every Community
// product's sign-in reads as the same product family. Hidden below lg, where
// each screen renders BrandMark above its form card instead.
//
// Everything it needs is styled by the `.onboarding*` block in globals.css;
// the copy is Drop's own and comes from next-intl rather than being inlined
// the way dokgistry does it, because Drop ships in two languages.
export function BrandPanel({ headline, tagline }: { headline: string; tagline: string }) {
  const t = useTranslations("common");
  const features = t.raw("features") as string[];

  return (
    <section className="onboardingBranding">
      <div className="orb orbTopRight" aria-hidden="true" />
      <div className="orb orbBottomLeft" aria-hidden="true" />
      <div className="orbRing" aria-hidden="true" />
      <div className="orbitGlow" aria-hidden="true" />

      <div className="onboardingBrandingContent">
        <div className="brandRow">
          <span className="brandLogo">
            <Package className="brandIcon" aria-hidden="true" />
          </span>
          <span className="brandName">{t("appName")}</span>
        </div>

        <div className="onboardingHeadline">
          <h1>{headline}</h1>
          <p className="brandTagline">{tagline}</p>
          <ul className="featureList">
            {features.map((feature) => (
              <li key={feature}>
                <span className="featureCheck">
                  <Check aria-hidden="true" />
                </span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="onboardingFooter">
          <span>{t("poweredBy")}</span>
        </div>
      </div>
    </section>
  );
}

/** Compact mark shown above the form card on mobile, where BrandPanel is hidden. */
export function BrandMark() {
  const t = useTranslations("common");
  return (
    <div className="brandMark brandMarkMobile">
      <span className="brandLogo">
        <Package className="brandIcon" aria-hidden="true" />
      </span>
      <span className="brandName">{t("appName")}</span>
    </div>
  );
}
