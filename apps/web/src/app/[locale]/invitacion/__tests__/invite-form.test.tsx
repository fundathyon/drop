import { describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

const acceptInvitationAction = mock(async () => ({}) as { error?: string });

mock.module("@/lib/actions/invite", () => ({ acceptInvitationAction }));
// InviteForm renders a Link from @/i18n/navigation for the "go to login"
// button; stub it to a plain anchor so the test doesn't need next-intl's
// routing context.
mock.module("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const { InviteForm } = await import("../invite-form");

const messages = {
  common: {
    appName: "Drop",
    poweredBy: "Powered by Foundathyon",
    features: ["Publica una carpeta", "Cada publicación es una versión", "Comparte por rol"],
  },
  invite: {
    title: "Drop admin",
    headline: "Únete a Drop",
    tagline: "Te han invitado a una organización.",
    pill: "Invitación",
    heading: "Crea tu cuenta",
    invalidPill: "Invitación no válida",
    namePlaceholder2: "Tu nombre",
    passwordPlaceholder: "Al menos 8 caracteres",
    passwordConfirmPlaceholder: "Repite la contraseña",
    submitting: "Creando cuenta…",
    invitedDescription: "Te han invitado como <email></email> con el rol <role></role>. Elige una contraseña para crear tu cuenta.",
    name: "Nombre",
    namePlaceholder: "(la parte antes de la @ si lo dejas vacío)",
    password: "Contraseña",
    passwordHint: "Mínimo 8 caracteres. La longitud es lo que cuenta.",
    passwordConfirm: "Repite la contraseña",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    submit: "Crear cuenta",
    passwordMismatch: "Las contraseñas no coinciden.",
    invalidMessage: "Esta invitación ya no es válida. Pide una nueva al administrador.",
    invalidFooter: "Las invitaciones caducan y son de un solo uso.",
    goToLogin: "Ir a entrar",
    roleAdmin: "admin",
    roleUser: "user",
  },
};

function renderForm(invitation: { email: string; role: "admin" | "user" } | null) {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <InviteForm
        token="tok-123"
        invitation={
          invitation && {
            id: 2,
            email: invitation.email,
            role: invitation.role,
            status: "pending",
            expires_at: "2024-01-01T00:00:00Z",
            created_at: "2024-01-01T00:00:00Z",
          }
        }
      />
    </NextIntlClientProvider>
  );
}

describe("InviteForm", () => {
  test("renders the not-acceptable view when there is no invitation", () => {
    renderForm(null);
    expect(screen.getByText("Drop admin")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Esta invitación ya no es válida");
    expect(screen.getByRole("link", { name: "Ir a entrar" })).toHaveAttribute("href", "/login");
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });

  test("renders the form with the invitee's email and role for a valid invitation", () => {
    renderForm({ email: "invitee@drop.test", role: "admin" });
    expect(screen.getByText("invitee@drop.test")).toBeTruthy();
    expect(screen.getByText("admin")).toBeTruthy();
    expect(screen.getByLabelText("Nombre")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña")).toBeTruthy();
    expect(screen.getByLabelText("Repite la contraseña")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows the translated copy for a known error code", async () => {
    acceptInvitationAction.mockImplementationOnce(async () => ({ error: "passwordMismatch" }));
    const { container } = renderForm({ email: "invitee@drop.test", role: "user" });
    // happy-dom doesn't fully implement the browser's own
    // click-a-submit-button -> form.requestSubmit() wiring that React relies
    // on, so a click on the button never reaches React's submit listener;
    // firing "submit" on the form directly is the reliable way to trigger a
    // useActionState-bound action under this environment.
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
  });

  test("shows a raw API message verbatim for an unrecognized error code", async () => {
    acceptInvitationAction.mockImplementationOnce(async () => ({ error: "a name is too long" }));
    const { container } = renderForm({ email: "invitee@drop.test", role: "user" });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("a name is too long");
  });

  test("switches to the not-acceptable view when the token goes bad mid-flight", async () => {
    acceptInvitationAction.mockImplementationOnce(async () => ({ error: "invalidInvitation" }));
    const { container } = renderForm({ email: "invitee@drop.test", role: "user" });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByText("Esta invitación ya no es válida. Pide una nueva al administrador.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ir a entrar" })).toBeTruthy();
  });
});
