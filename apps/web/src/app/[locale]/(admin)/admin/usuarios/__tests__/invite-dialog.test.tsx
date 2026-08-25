import { describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InviteForm, InviteLinkReveal } from "../invite-dialog-views";

// InviteForm and InviteLinkReveal are the two halves of the invite dialog's
// two-phase body (form, then one-time link reveal). Both are plain,
// presentational — they take their state as props rather than calling
// useActionState themselves — specifically so they can be rendered and
// asserted on directly here, without having to drive a real form submission
// through React's action/useActionState machinery in a test environment.
// (InviteDialog itself, which does own that hook, is exercised indirectly
// through the createInvitationAction tests in actions.test.ts instead.)

const messages = {
  users: {
    invite: "Invitar",
    inviteDialog: {
      description: "No se envía ningún correo: se genera un enlace de un solo uso que le haces llegar tú.",
      emailLabel: "Email",
      emailPlaceholder: "persona@ejemplo.com",
      roleLabel: "Rol",
      roleUser: "user",
      roleAdmin: "admin",
      submit: "Crear invitación",
      error: {
        invalidEmail: "Escribe un email válido.",
        alreadyExists: "Ese email ya tiene cuenta.",
        unexpected: "Error inesperado",
      },
      linkTitle: "Enlace de invitación",
      linkDescription: "Cópialo y hazlo llegar por el canal que quieras.",
      linkAriaLabel: "Enlace de invitación",
      copy: "Copiar",
      copied: "Copiado",
    },
  },
  common: {
    cancel: "Cancelar",
    close: "Cerrar",
  },
};

function withProviders(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="es" messages={messages}>
      <Dialog open>
        <DialogContent>{children}</DialogContent>
      </Dialog>
    </NextIntlClientProvider>
  );
}

describe("InviteForm", () => {
  test("renders the email/role form and submit label", () => {
    render(withProviders(<InviteForm action={() => {}} pending={false} onCancel={() => {}} />));

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByRole("button", { name: "Crear invitación" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows the translated error message when error is set", () => {
    render(withProviders(<InviteForm action={() => {}} pending={false} error="alreadyExists" onCancel={() => {}} />));

    expect(screen.getByRole("alert")).toHaveTextContent("Ese email ya tiene cuenta.");
  });

  test("disables submit while pending", () => {
    render(withProviders(<InviteForm action={() => {}} pending={true} onCancel={() => {}} />));

    expect(screen.getByRole("button", { name: "Crear invitación" })).toBeDisabled();
  });

  test("calls onCancel when Cancelar is clicked", () => {
    const onCancel = mock(() => {});
    render(withProviders(<InviteForm action={() => {}} pending={false} onCancel={onCancel} />));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("InviteLinkReveal", () => {
  test("shows the one-time link and closes on Cerrar", () => {
    const onClose = mock(() => {});
    render(withProviders(<InviteLinkReveal link="https://drop.test/invite/abc123" onClose={onClose} />));

    const input = screen.getByRole("textbox", { name: "Enlace de invitación" }) as HTMLInputElement;
    expect(input.value).toBe("https://drop.test/invite/abc123");
    expect(input).toHaveAttribute("readonly");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("copies the link to the clipboard and swaps the button text", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(withProviders(<InviteLinkReveal link="https://drop.test/invite/abc123" onClose={() => {}} />));

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));

    expect(writeText).toHaveBeenCalledWith("https://drop.test/invite/abc123");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument());
  });

  test("reverts the button text back to Copiar after the timeout", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(withProviders(<InviteLinkReveal link="https://drop.test/invite/abc123" onClose={() => {}} />));

    fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument(), {
      timeout: 2500,
    });
  });
});
