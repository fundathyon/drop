import { describe, expect, test } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { Dropzone } from "../dropzone";

const messages = {
  explorer: {
    newDropDialog: {
      dropzoneInstructions: "Arrastra tus archivos aquí, o haz clic para elegirlos",
      removeFileAriaLabel: "Quitar {name}",
    },
  },
};

const instructions = "Arrastra tus archivos aquí, o haz clic para elegirlos";

function renderDropzone() {
  return render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <Dropzone id="new-drop-files" name="files" />
    </NextIntlClientProvider>
  );
}

function getInput() {
  return screen.getByLabelText(instructions) as HTMLInputElement;
}

describe("Dropzone", () => {
  test("renders the drop instructions and no file list initially", () => {
    renderDropzone();
    expect(screen.getByText(instructions)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("lists a browsed file with its size and reflects it on the underlying input", () => {
    renderDropzone();
    const input = getInput();
    const file = new File(["hello"], "index.html", { type: "text/html" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByText("index.html")).toBeInTheDocument();
    expect(screen.getByText("5 B")).toBeInTheDocument();
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0].name).toBe("index.html");
  });

  test("accumulates files across multiple selections instead of replacing them", () => {
    renderDropzone();
    const input = getInput();
    fireEvent.change(input, { target: { files: [new File(["a"], "a.html")] } });
    fireEvent.change(input, { target: { files: [new File(["bb"], "b.css")] } });

    expect(screen.getByText("a.html")).toBeInTheDocument();
    expect(screen.getByText("b.css")).toBeInTheDocument();
    expect(input.files).toHaveLength(2);
  });

  test("tracks drag-over/drag-leave without changing the file list", () => {
    renderDropzone();
    const zone = screen.getByText(instructions);
    fireEvent.dragOver(zone);
    fireEvent.dragLeave(zone);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("adds files dropped onto the zone", () => {
    renderDropzone();
    const file = new File(["hi"], "dropped.png");
    fireEvent.drop(screen.getByText(instructions), { dataTransfer: { files: [file] } });

    expect(screen.getByText("dropped.png")).toBeInTheDocument();
    expect(getInput().files).toHaveLength(1);
  });

  test("ignores a drop carrying no files", () => {
    renderDropzone();
    fireEvent.drop(screen.getByText(instructions), { dataTransfer: { files: [] } });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  test("removes a file from the list and the underlying input", () => {
    renderDropzone();
    const input = getInput();
    fireEvent.change(input, { target: { files: [new File(["a"], "a.html"), new File(["bb"], "b.css")] } });

    fireEvent.click(screen.getByRole("button", { name: "Quitar a.html" }));

    expect(screen.queryByText("a.html")).not.toBeInTheDocument();
    expect(screen.getByText("b.css")).toBeInTheDocument();
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0].name).toBe("b.css");
  });

  test("removing every file drops the list back out of the document", () => {
    renderDropzone();
    const input = getInput();
    fireEvent.change(input, { target: { files: [new File(["a"], "a.html")] } });

    fireEvent.click(screen.getByRole("button", { name: "Quitar a.html" }));

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(input.files).toHaveLength(0);
  });
});
