// @testing-library/jest-dom ships this exact augmentation as
// types/bun.d.ts, but it's only reachable through the package's "." export
// (types/index.d.ts), which references types/jest.d.ts (the `jest` global
// namespace) instead — there's no subpath in its "exports" map that reaches
// types/bun.d.ts directly. Mirroring its content here is what wires the
// jest-dom matchers (toBeInTheDocument, toHaveAttribute, ...) into bun:test's
// own `expect` for every test file, without editing the package itself.
import type { expect } from "bun:test";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- pure declaration-merging: adds no members of its own, only inherits jest-dom's.
  interface Matchers<T = unknown> extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
