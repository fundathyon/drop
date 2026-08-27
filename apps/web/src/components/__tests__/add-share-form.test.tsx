import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

// AddShareForm imports the real shareAction from "@/lib/actions/sharing", a
// "use server" file that in turn reaches into @/lib/api and @/lib/session.
// Mock it the same way the actions.test.ts files do, so this stays a pure
// component test of the wiring (state -> rendered error, success -> form
// reset) rather than re-exercising shareAction's own validation.
const shareAction = mock(async () => ({}) as { error?: "userRequired" | "unexpected" });
mock.module("@/lib/actions/sharing", () => ({ shareAction }));

const { AddShareForm } = await import("../add-share-form");

const messages = {
  sharing: {
    personLabel: "Persona",
    personPlaceholder: "Elige una cuenta…",
    accessLabel: "Acceso",
    accessViewerOption: "lector — abrir y descargar",
    accessEditorOption: "editor — además subir, editar y borrar dentro",
    submit: "Compartir",
    sharing: "Compartiendo…",
    error: {
      userRequired: "Elige una cuenta para compartir.",
      unexpected: "Error inesperado",
    },
  },
};

const candidates = [
  { id: 1, email: "ana@drop.test", name: "Ana", role: "user" as const, active: true, created_at: "2024-01-01T00:00:00Z" },
];

function renderForm() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <AddShareForm path="proyectos/site" owner={undefined} candidates={candidates} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  shareAction.mockClear();
});

describe("AddShareForm", () => {
  test("renders the person/access selects and the submit button", () => {
    renderForm();
    expect(screen.getByText("Persona")).toBeInTheDocument();
    expect(screen.getByText("Acceso")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compartir" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows the translated validation error when no person was chosen", async () => {
    shareAction.mockImplementationOnce(async () => ({ error: "userRequired" }));
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    await waitFor(() => expect(shareAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("Elige una cuenta para compartir.");
  });

  test("shows the generic error for an unexpected failure", async () => {
    shareAction.mockImplementationOnce(async () => ({ error: "unexpected" }));
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Error inesperado");
  });

  test("shows no error once a submit succeeds", async () => {
    shareAction.mockImplementationOnce(async () => ({}));
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Compartir" }));

    await waitFor(() => expect(shareAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
