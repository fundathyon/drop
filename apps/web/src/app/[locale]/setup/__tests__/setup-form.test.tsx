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
  setup: {
    title: "Configura Drop",
    description: "Primer arranque: crea la organización y la cuenta de administrador que la gestiona.",
    orgName: "Organización",
    name: "Tu nombre",
    namePlaceholder: "(la parte antes de la @ si lo dejas vacío)",
    email: "Email",
    password: "Contraseña maestra",
    passwordHint: "Mínimo 8 caracteres. La longitud es lo que cuenta.",
    passwordConfirm: "Repite la contraseña",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    submit: "Configurar Drop",
    footer: "Este asistente solo aparece una vez.",
    passwordMismatch: "Las contraseñas no coinciden.",
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
  test("renders the heading and every field", () => {
    renderForm();
    expect(screen.getByText("Configura Drop")).toBeTruthy();
    expect(screen.getByLabelText("Organización")).toBeTruthy();
    expect(screen.getByLabelText("Tu nombre")).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Contraseña maestra")).toBeTruthy();
    expect(screen.getByLabelText("Repite la contraseña")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Configurar Drop" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("shows the translated copy for a known error code", async () => {
    setupAction.mockImplementationOnce(async () => ({ error: "passwordMismatch" }));
    const { container } = renderForm();
    // happy-dom doesn't fully implement the browser's own
    // click-a-submit-button -> form.requestSubmit() wiring that React relies
    // on, so a click on the button never reaches React's submit listener;
    // firing "submit" on the form directly is the reliable way to trigger a
    // useActionState-bound action under this environment.
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
  });

  test("shows a raw API message verbatim for an unrecognized error code", async () => {
    setupAction.mockImplementationOnce(async () => ({ error: "an organization name is required" }));
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("an organization name is required");
  });
});
