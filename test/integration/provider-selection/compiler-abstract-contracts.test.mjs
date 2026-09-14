import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler abstract contracts retain base state and concrete subclass dispatch", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "abstract_contracts" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let initialized = 0;
abstract class Base {
  abstract readonly count: number;
  constructor(readonly prefix: string) { initialized++; }
  abstract read(): string;
  label(): string { return this.prefix + this.read(); }
}
class First extends Base {
  readonly count: number = 3;
  constructor() { super("first:"); }
  read(): string { return "one"; }
}
class Second extends Base {
  readonly count: number = 5;
  constructor() { super("second:"); }
  read(): string { return "two"; }
}
function label(value: Base): string { return value.label(); }
function count(value: Base): number { return value.count; }
export function main(): void {
  const first = new First();
  const second = new Second();
  check(label(first) === "first:one" && label(second) === "second:two");
  check(count(first) === 3 && count(second) === 5 && initialized === 2);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /struct BaseRoot\b/u);
  validateGeneratedProject("compiler-abstract-contracts", result.artifacts, { run: true });
});

test("abstract source construction remains a checker error", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
abstract class Base { abstract read(): number; }
export const invalid = new Base();
` } }), /TS2511/u);
});
