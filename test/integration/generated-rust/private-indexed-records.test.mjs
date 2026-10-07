import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("private indexed records preserve their authored closed values and aliasing", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
class Settings {
  readonly #values: Record<string, unknown> = {};
  set(key: string, value: unknown): void { this.#values[key] = value; }
  get(key: string): unknown { return this.#values[key]; }
}
export function run(): boolean {
  const settings = new Settings();
  settings.set("label", "before");
  const alias = settings;
  alias.set("label", "after");
  settings.set("empty", undefined);
  return settings.get("label") === "after" && alias.get("missing") === undefined &&
    settings.get("empty") === undefined;
}
export function main(): void { check(run()); }
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("private-indexed-records", result.artifacts, { run: true });
});
