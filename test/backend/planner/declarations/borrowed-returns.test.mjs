import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const borrowedSource = `export function main(): void {
  let calls = 0;
  const read = (value: string): string => { calls++; return value; };
  const value = "first";
  if (read(value) !== value) throw new Error("first identity");
  {
    const local = "short lived";
    if (read(local) !== "short lived") throw new Error("short input lifetime");
  }
  if (read(value) !== "first") throw new Error("independent invocation lifetime");
  const expressionRead = (input: string): string => input;
  if (expressionRead(value) !== value) throw new Error("expression identity");
  function declarationRead(input: string): string { calls++; return input; }
  if (declarationRead(value) !== value || declarationRead("temporary") !== "temporary")
    throw new Error("declaration identity");
  if (calls !== 5) throw new Error("capture effects/order");
}`;

const ownedSource = `export function main(): void {
  const mutate = (input: string): string => { input = "changed"; return input; };
  const original = "original";
  if (mutate(original) !== "changed" || original !== "original") throw new Error("parameter mutation");
  let escaped = "";
  {
    const read = (input: string): string => input;
    const local = "owned past scope";
    escaped = read(local);
  }
  if (escaped !== "owned past scope") throw new Error("result outlives input");
}`;

const interferenceSource = `export function main(): void {
  let captured = "first";
  let calls = 0;
  const capturedRead = (input: string): string => { calls++; captured = "changed"; return input; };
  const capturedMatches = capturedRead(captured) === "first" && captured === "changed" && calls === 1;
  let compared = "before";
  const comparedRead = (input: string): string => input;
  const change = (): string => { calls++; compared = "after"; return compared; };
  const comparisonMatches = comparedRead(compared) !== change() && compared === "after" && calls === 2;
  if (!capturedMatches || !comparisonMatches)
    throw new Error("comparison changed the input snapshot or evaluation order");
}`;

test("fallible lexical identity loans retain native error and call evaluation order", () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `export function main(): void {
      let produced = 0;
      let observed = 0;
      const produce = (): string => { produced++; return "temporary"; };
      const read = (value: string): string => {
        observed++;
        if (value === "fail") throw new Error("expected");
        return value;
      };
      if (read(produce()) !== "temporary") throw new Error("temporary input");
      let caught = false;
      try { if (read("fail") !== "fail") throw new Error("unexpected"); } catch { caught = true; }
      if (!caught || produced !== 1 || observed !== 2) throw new Error("evaluation order");
    }
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  const generated = artifactText(result, "src/index.rs");
  assert.equal(/fn read<'input>\([^)]*: &'input str[^)]*\) -> Result<&'input str,/u.test(generated), true,
    "the fallible identity reader has the same exact native input/output loan");
  assert.doesNotMatch(generated, /clone\(|Callable|RefCell|Rc<|Box</u);
  validateGeneratedProject("fallible-lexical-borrowed-return", result.artifacts, { run: true });
});

for (const surface of ["native", "js"]) {
  for (const [name, source] of [["borrowed", borrowedSource], ["owned", ownedSource], ["interference", interferenceSource]]) {
    test(`${surface} ${name} lexical results preserve exact native ownership and lifetimes`, () => {
      const { result } = compileRust({ files: { "index.ts": source + "\nmain();\n" },
        surfaces: surface === "js" ? ["js"] : [], target: { id: "rust", options: { outputType: "bin" } } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
      const generated = artifactText(result, "src/index.rs");
      if (name === "borrowed") {
        for (const functionName of ["read", "expressionRead", "declarationRead"]) {
          assert.equal(new RegExp(`fn ${functionName}<'input>\\([^)]*: &'input str[^)]*\\) -> &'input str`, "u").test(generated),
            true, `${functionName} has a per-invocation native input/output loan`);
        }
        assert.equal(/clone\(|Callable|RefCell|Rc<|Box</u.test(generated), false, "identity observation stays allocation/copy free");
      } else if (name === "owned") {
        assert.match(generated, /fn read\(input: String\) -> String/u);
        // The parameter's passed value is overwritten before any read (rustc unused_assignments), so it carries the
        // checked-evaluation-order expectation.
        assert.match(generated, /fn mutate\(\s*#\[expect\(unused_assignments, reason = "checked source evaluation order"\)\] mut input: String,?\s*\) -> String/u);
        assert.doesNotMatch(generated, /fn (?:read|mutate)<'input>/u);
      } else {
        assert.match(generated, /fn capturedRead\(input: String,/u);
        assert.match(generated, /fn comparedRead\(input: String\) -> String/u);
        assert.doesNotMatch(generated, /fn (?:capturedRead|comparedRead)<'input>/u);
        assert.equal(/change\(&mut calls, &mut compared\)/u.test(generated), true,
          "the mutable lexical capture borrows the original owner, not an owned snapshot");
        assert.equal(/comparedRead\(compared\.clone\(\)\)/u.test(generated), true,
          "the earlier comparison operand still owns its required pre-mutation snapshot");
      }
      validateGeneratedProject(`lexical-${name}-return-${surface}`, result.artifacts, { run: true });
    });
  }
}
