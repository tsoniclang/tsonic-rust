import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compile(name, source) {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "bin", crateName: name } },
    files: { "index.ts": source },
  });
  assert.deepEqual(result.diagnostics.map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message })), []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  validateGeneratedProject(name, result.artifacts, { run: true });
  assert.doesNotMatch(generated, /Box<|dyn /u);
  return generated;
}

test("generic factories keep unrelated native capture types independent through returned aliases", { timeout: 300_000 }, () => {
  compile("generic_physical_capture_factories", `
    type Identity = <Value>(value: Value) => Value;
    function first(left: () => number): Identity {
      const original = <Value>(value: Value): Value => { left(); return value; };
      const alias: Identity = original; return alias;
    }
    function second(right: () => string): Identity {
      return <Value>(value: Value): Value => { right(); return value; };
    }
    export function main(): void {
      const left = first(() => 1);
      const right = second(() => "native");
      if (left<number>(7) !== 7 || right<string>("exact") !== "exact") throw new Error("capture");
    }
  `);
});

test("one generic factory joins two exact native captured inputs without losing either variant", { timeout: 300_000 }, () => {
  compile("generic_physical_capture_join", `
    type Identity = <Value>(value: Value) => Value;
    function make(callback: () => number): Identity {
      return <Value>(value: Value): Value => { callback(); return value; };
    }
    function choose(left: () => number, right: () => number, select: boolean): Identity {
      return select ? make(left) : make(right);
    }
    export function main(): void {
      const left = () => 1;
      const right = () => 2;
      const first = choose(left, right, true);
      const second = choose(left, right, false);
      if (first<number>(7) !== 7 || second<string>("exact") !== "exact") throw new Error("join");
    }
  `);
});
