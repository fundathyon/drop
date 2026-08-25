import { describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

// The Server Action itself (server-only imports, Go API calls) is exercised
// in lib/actions/__tests__/setup.test.ts. Here the component is mocked to a
// plain async function so the form's own rendering/branching logic can be
// tested in isolation, the same separation of concerns as the rest of the
// suite.
const setupAction = mock(async () => ({}) as { error?: string });

mock.module("@/lib/actions/setup", () => ({ setupAction }));

const { SetupForm } = await import("../setup-form");

const messages = {
  common: {
    appName: "Drop",
    poweredBy: "Powered by Foundathyon",
    features: ["Publica una carpeta", "Cada publicación es una versión", "Comparte por rol"],
  },
  setup: {
    headline: "Configura Drop",
    tagline: "Un Drive para publicar carpetas como sitios web estáticos.",
    pill: "Configuración inicial",
    title: "Configura Drop",
    description: "Primer arranque: crea la organización y la cuenta de administrador que la gestiona.",
    orgName: "Organización",
    orgNamePlaceholder: "Mi empresa",
    email: "Email",
    emailPlaceholder: "admin@empresa.com",
    password: "Contraseña maestra",
    passwordPlaceholder: "Al menos 8 caracteres",
    passwordHint: "Mínimo 8 caracteres. La longitud es lo que cuenta.",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    submit: "Configurar Drop",
    submitting: "Guardando…",
    footer: "Este asistente solo aparece una vez.",
    unexpected: "Error inesperado. Vuelve a intentarlo.",
  },
};

function renderForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <SetupForm />
    </NextIntlClientProvider>
  );
}

describe("SetupForm", () => {
  test("asks for organization, email and password, in one step", () => {
    const { container } = renderForm();

    expect(screen.getByLabelText("Organización")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configurar Drop" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();

    // Exactly three inputs: no display name, and the password is asked once.
    const named = [...container.querySelectorAll<HTMLInputElement>("input[name]")].map((i) => i.name);
    expect(named.sort()).toEqual(["email", "org_name", "password"]);
  });

  test("reveals and re-hides the password, flipping the toggle's label", () => {
    const { container } = renderForm();
    const password = container.querySelector<HTMLInputElement>("input[name='password']")!;
    expect(password.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(password.type).toBe("password");
  });

  test("shows the translated copy for a known error code", async () => {
    setupAction.mockImplementationOnce(async () => ({ error: "unexpected" }));
    const { container } = renderForm();
    // happy-dom doesn't fully implement the browser's own
    // click-a-submit-button -> form.requestSubmit() wiring that React relies
    // on, so a click on the button never reaches React's submit listener;
    // firing "submit" on the form directly is the reliable way to trigger a
    // useActionState-bound action under this environment.
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Error inesperado. Vuelve a intentarlo.");
  });

  test("shows a raw API message verbatim for an unrecognized error code", async () => {
    setupAction.mockImplementationOnce(async () => ({ error: "an organization name is required" }));
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("an organization name is required");
  });
});
