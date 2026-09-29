import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`union arm correspondence preserves subsets and widening on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";

type Pair = string | number;
type Wide = Pair | boolean;
function widen(value: Pair): Wide { return value; }
function narrow(value: Wide): Pair {
  if (typeof value === "boolean") return 7;
  return value;
}
function optional(value: Wide | undefined): Pair | undefined {
  if (typeof value === "boolean") return undefined;
  return value;
}
function widenOptional(value: Pair | undefined): Wide | undefined { return value; }
function text(value: Pair): string {
  if (typeof value === "string") return value;
  return "number";
}
class Counter { calls = 0; }
function count(value: Pair, counter: Counter): Pair { counter.calls++; return value; }
function callable(value: string | number | (() => string)): string | (() => string) {
  if (typeof value === "number") return "number";
  return value;
}
function call(value: string | (() => string)): string {
  if (typeof value === "string") return value;
  return value();
}
export function run(): boolean {
  const counter = new Counter();
  const widened = widen(count("once", counter));
  const result = text(narrow(widened));
  const retained = text(narrow(widened));
  return result === "once" && retained === "once" && counter.calls === 1 &&
    text(narrow(widen(3))) === "number" && text(narrow(true)) === "number" &&
    optional(undefined) === undefined && optional(false) === undefined &&
    optional("kept") === "kept" && optional(9) === 9 &&
    widenOptional(undefined) === undefined && widenOptional("wide") === "wide" &&
    call(callable(() => "called")) === "called" && call(callable("text")) === "text" && call(callable(4)) === "number";
}

export function main(): void { check(run()); }
` } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("union-mappings", result.artifacts, { run: true });
  });
}
