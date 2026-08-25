import { describe, expect, test } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "../password-input";

describe("PasswordInput", () => {
  test("starts masked and toggles to visible text, flipping the aria-label", () => {
    const { container } = render(
      <PasswordInput id="password" name="password" showLabel="Mostrar contraseña" hideLabel="Ocultar contraseña" />
    );

    const input = container.querySelector("input[name='password']") as HTMLInputElement;
    expect(input.type).toBe("password");

    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });
    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Ocultar contraseña" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(input.type).toBe("password");
    expect(screen.getByRole("button", { name: "Mostrar contraseña" })).toBeTruthy();
  });

  test("forwards id, name and other input props so two instances never collide", () => {
    const { container } = render(
      <PasswordInput
        id="password_confirm"
        name="password_confirm"
        autoComplete="new-password"
        required
        defaultValue="prefilled"
        showLabel="Mostrar contraseña"
        hideLabel="Ocultar contraseña"
      />
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.id).toBe("password_confirm");
    expect(input.name).toBe("password_confirm");
    expect(input.autocomplete).toBe("new-password");
    expect(input.required).toBe(true);
    expect(input.value).toBe("prefilled");
  });
});
