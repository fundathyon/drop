import { afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "bun:test";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
