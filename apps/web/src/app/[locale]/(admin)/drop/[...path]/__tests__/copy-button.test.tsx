import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CopyButton } from "../copy-button";

let originalClipboard: Clipboard | undefined;

beforeEach(() => {
  originalClipboard = navigator.clipboard;
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
});

describe("CopyButton", () => {
  test("copies the given text and swaps to the copied icon/label", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <CopyButton
        text="https://example.com/proyectos/site"
        ariaLabel="Copiar URL"
        copiedAriaLabel="URL copiada"
        resetDelayMs={20}
      />
    );

    const button = screen.getByRole("button", { name: "Copiar URL" });
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://example.com/proyectos/site"));
    await waitFor(() => expect(screen.getByRole("button", { name: "URL copiada" })).toBeInTheDocument());
  });

  test("reverts back to the idle label after the reset delay", async () => {
    const writeText = mock(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <CopyButton
        text="https://example.com/proyectos/site"
        ariaLabel="Copiar URL"
        copiedAriaLabel="URL copiada"
        resetDelayMs={10}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copiar URL" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "URL copiada" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiar URL" })).toBeInTheDocument());
  });
});
