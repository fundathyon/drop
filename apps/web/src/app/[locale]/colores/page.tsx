import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Rocket } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  FormField,
  Heading,
  Input,
  Select,
  SelectItem,
  StatusBadge,
  Text,
} from "@foundathyon/community-ui";
import { ACCENT_IDS } from "@/lib/accents";
import { SHOW_PALETTE_TOOLS } from "@/lib/flags";
import { AccentPicker } from "@/components/accent-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { FinderIcon } from "@/components/finder-icon";
import { ACCENT_TEXT } from "@/lib/filetype";

/**
 * Palette proof sheet. Every swatch here is painted by a real design-system
 * token, never a literal — so switching the accent (picker, top right) or the
 * theme repaints the page, and anything that looks wrong here is wrong in the
 * product too.
 *
 * A developer surface: it 404s in a production build, the same gate that hides
 * the picker (lib/flags.ts) and lets proxy.ts reach it without a session.
 */

const ACCENT_STEPS = [
  { token: "bg-accent-solid", label: "accent-solid", fg: "text-accent-on-solid" },
  { token: "bg-accent-solid-hover", label: "accent-solid-hover", fg: "text-accent-on-solid" },
  { token: "bg-accent-solid-active", label: "accent-solid-active", fg: "text-accent-on-solid" },
  { token: "bg-accent-bg", label: "accent-bg", fg: "text-accent" },
];

const TONES = [
  { name: "success", solid: "bg-success-solid", wash: "bg-success-bg", text: "text-success" },
  { name: "warning", solid: "bg-warning-solid", wash: "bg-warning-bg", text: "text-warning" },
  { name: "danger", solid: "bg-danger-solid", wash: "bg-danger-bg", text: "text-danger" },
  { name: "info", solid: "bg-info-solid", wash: "bg-info-bg", text: "text-info" },
];

const SURFACES = [
  { token: "bg-bg", label: "bg" },
  { token: "bg-bg-subtle", label: "bg-subtle" },
  { token: "bg-surface", label: "surface" },
  { token: "bg-surface-raised", label: "surface-raised" },
  { token: "bg-surface-hover", label: "surface-hover" },
];

const TEXTS = [
  { token: "text-text", label: "text" },
  { token: "text-text-secondary", label: "text-secondary" },
  { token: "text-text-muted", label: "text-muted" },
  { token: "text-text-disabled", label: "text-disabled" },
];

const SAMPLE_FILES = ["index.html", "styles.css", "app.js", "types.ts", "data.json", "logo.svg", "manual.pdf"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Text variant="overline" tone="muted">
        {title}
      </Text>
      {children}
    </section>
  );
}

function Swatch({ className, label, fg = "" }: { className: string; label: string; fg?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`border-border flex h-16 items-end justify-start rounded-lg border p-2 ${className} ${fg}`}
      >
        <span className="text-[10px] font-medium">Aa</span>
      </div>
      <Text variant="caption" tone="muted" className="font-mono">
        {label}
      </Text>
    </div>
  );
}

export default async function PalettePage() {
  if (!SHOW_PALETTE_TOOLS) notFound();

  const t = await getTranslations("colors");

  return (
    <main className="bg-bg text-text min-h-svh">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Heading level={1}>{t("pageTitle")}</Heading>
            <Text tone="muted" className="max-w-xl">
              {t("pageDescription")}
            </Text>
          </div>
          <div className="flex items-center gap-1">
            <AccentPicker />
            <ThemeToggle ariaLabel={t("title")} />
          </div>
        </header>

        <Section title={t("sectionAccent")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ACCENT_STEPS.map((step) => (
              <Swatch key={step.label} className={step.token} label={step.label} fg={step.fg} />
            ))}
          </div>

          {/* The whole wheel at once, each swatch redefining the accent
              variables for its own subtree — the same trick the picker's dots
              use, so what you see here is exactly what choosing it would give. */}
          <div className="mt-2 grid grid-cols-7 gap-2 sm:grid-cols-14">
            {ACCENT_IDS.map((id) => (
              <div key={id} data-accent={id} className="flex flex-col items-center gap-1.5">
                <span className="accentSwatch border-border size-9 rounded-full border" />
                <Text variant="caption" tone="muted" className="truncate">
                  {t(`names.${id}`)}
                </Text>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("sectionSemantic")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TONES.map((tone) => (
              <div key={tone.name} className="flex flex-col gap-2">
                <Swatch className={tone.solid} label={`${tone.name}-solid`} fg="text-on-solid" />
                <div className={`border-border rounded-lg border p-2 ${tone.wash}`}>
                  <span className={`text-[11px] font-medium ${tone.text}`}>{tone.name}-bg · -text</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status="active">active</StatusBadge>
            <StatusBadge status="pending">pending</StatusBadge>
            <StatusBadge status="failed">failed</StatusBadge>
            <StatusBadge status="expired">expired</StatusBadge>
            <StatusBadge status="unknown">unknown</StatusBadge>
          </div>
        </Section>

        <Section title={t("sectionSurfaces")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SURFACES.map((s) => (
              <Swatch key={s.label} className={s.token} label={s.label} />
            ))}
          </div>
          <div className="border-border bg-surface flex flex-col gap-1 rounded-lg border p-4">
            {TEXTS.map((item) => (
              <p key={item.label} className={`text-sm ${item.token}`}>
                <span className="font-mono text-[11px]">{item.label}</span> — Un Drive para publicar carpetas.
              </p>
            ))}
          </div>
        </Section>

        <Section title={t("sectionFiletypes")}>
          <div className="flex flex-wrap items-end gap-4">
            <FinderIcon kind="folder" size={56} />
            <FinderIcon kind="drop" size={56} />
            {SAMPLE_FILES.map((name) => (
              <FinderIcon key={name} kind="file" name={name} size={56} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {SAMPLE_FILES.map((name) => (
              <span key={name} className={`font-mono text-[11px] ${ACCENT_TEXT["ft-neutral"]}`}>
                {name}
              </span>
            ))}
          </div>
        </Section>

        <Section title={t("sectionComponents")}>
          <div className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" leading={<Rocket />}>
                Primary
              </Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="destructive-subtle">Destructive subtle</Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="tonal" tone="neutral">
                tonal
              </Badge>
              <Badge variant="outline" tone="neutral">
                outline
              </Badge>
              <Badge variant="solid" tone="info">
                solid
              </Badge>
              <Badge variant="counter" tone="neutral">
                12
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Input" description="Focus me to see the ring take the accent.">
                <Input placeholder="drop.example.com" />
              </FormField>
              <FormField label="Select">
                <Select defaultValue="public">
                  <SelectItem value="private">private</SelectItem>
                  <SelectItem value="unlisted">unlisted</SelectItem>
                  <SelectItem value="public">public</SelectItem>
                </Select>
              </FormField>
            </div>

            <Alert tone="info" title="Info">
              Las alertas usan el tono semántico, nunca el acento.
            </Alert>
          </div>
        </Section>
      </div>
    </main>
  );
}
