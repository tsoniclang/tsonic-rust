import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("indexed callables retain exact presence, evaluation order and shared mutation", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
      let events = "";
      function observed(): string { return events; }
      function index(): number { events += "i"; return 0; }
      function argument(): number { events += "a"; return 2; }
      export function main(): void {
        let total = 0;
        const callbacks: ((value: number) => number)[] = [value => { events += "c"; total += value; return total; }];
        if (callbacks[index()](argument()) !== 2 || observed() !== "iac") throw new Error("order");
        if ((callbacks[0])(3) !== 5 || total !== 5) throw new Error("identity");
        events = "";
        if (callbacks[1]?.(argument()) !== undefined || observed() !== "") throw new Error("absent");
        if (callbacks[0]?.(argument()) !== 7 || observed() !== "ac") throw new Error("present");
      }
    ` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.get_number\([^\n]*\)\.call/u);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.get_number\([^\n]*\)\.as_ref\(\)/u);
  validateGeneratedProject("indexed-callables", result.artifacts, { run: true });
});

test("nullable indexed callables still require checked presence", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function invoke(callbacks: (((value: number) => number) | undefined)[]): number {
      return callbacks[0](2);
    }
  ` } }), /TS2722: Cannot invoke an object which is possibly 'undefined'/u);
});
