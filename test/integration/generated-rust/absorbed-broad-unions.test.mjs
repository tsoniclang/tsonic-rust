import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("authored broad unions preserve their checked broad carrier across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "values.ts": `
export type Value = unknown | number | undefined;
export class Store {
  readonly value: unknown;
  constructor(value: unknown) { this.value = value; }
  read(): unknown | undefined | this { return this.value; }
}
export function identity(value: Value): Value { return value; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import { Store, identity } from "./values.js";
export function main(): void {
  check(new Store("kept").read() === "kept");
  check(new Store(undefined).read() === undefined);
  check(identity(3) === 3 && identity("text") === "text" && identity(undefined) === undefined);
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("absorbed-broad-unions", result.artifacts, { run: true });
});
