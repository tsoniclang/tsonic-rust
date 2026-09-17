import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("class constructor views retain identity and live static storage across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_constructor_values" } },
    files: {
      "classes.ts": `
export class First { static count: number = 1; static enabled: boolean = true; }
export class Second { static count: number = 1; static enabled: boolean = true; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import { First as Selected, Second } from "./classes.js";
type Full = { enabled: boolean; count: number; };
type Count = { count: number; };
function first(): Full { return Selected; }
function second(): Full { return Second; }
export function main(): void {
  const value: Full = Selected;
  const repeated: Full = Selected;
  const count: Count = Selected;
  check(value === repeated && value === first() && value !== second());
  check(value === count && value.count === 1 && value.enabled);
  Selected.count = 7;
  check(value.count === 7 && count.count === 7);
  value.count = 9;
  check(Selected.count === 9 && count.count === 9 && Second.count === 1);
  count.count = 12;
  check(value.count === 12 && Selected.count === 12);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("class-constructor-values", result.artifacts, { run: true });
});

test("unproved class constructor method views reject before publication", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: { "index.ts": `
class Factory { static read(): number { return 1; } }
export function view(): { read: () => number } { return Factory; }
` },
  });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error" &&
    /class.*value|constructor.*view/i.test(diagnostic.message)));
  assert.equal(result.artifacts.length, 0);
});
