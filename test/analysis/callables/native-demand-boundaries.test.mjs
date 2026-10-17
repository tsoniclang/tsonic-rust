import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";

const surfaces = [["native", []], ["js", ["js"]]];

for (const [surface, selected] of surfaces) {
  for (const [kind, prelude, body] of [
    ["object", "", 'function unused(key: string): number { const value = { [key]: 7 }; return 1; }'],
    ["struct", 'import { field, struct } from "@tsonic/core/lang.js"; function key(): "value" { return "value"; }',
      'function unused(): number { const Shape = struct({ [key()]: field<number>() }); return 1; }'],
  ]) {
    test(`erased ${kind} bodies impose no native storage or key obligation (${surface})`, () => {
      const source = `${prelude}
export function run(): number {
  ${body}
  return 42;
}`;
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, "unused native syntax is not admitted as a physical obligation");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true, "the native program is emitted");
      assert.equal(/\bfn unused\b/u.test(rustSourceText(result)), false, "the erased declaration has no native body");
    });

    test(`required ${kind} bodies retain their actual native key refusal (${surface})`, () => {
      const source = `${prelude}
export function run(): number {
  ${body}
  return ${kind === "object" ? 'unused("value")' : "unused()"};
}`;
      const { result } = compileRust({ surfaces: selected, files: { "index.ts": source } });
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.category === "error"), true,
        "an actual native representation is required and its invalid key is refused");
      assert.equal(result.program === undefined, true, "no partial target program");
      assert.equal(result.plan === undefined, true, "no partial native plan");
      assert.equal(result.artifacts.length, 0, "no partial native output");
    });
  }

  test(`erased descendants do not create signature, struct, capture or ownership-flow requests (${surface})`, () => {
    let context;
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
import { field, struct } from "@tsonic/core/lang.js";
function key(): "value" { return "value"; }
export function run(): number {
  function dormant(): number {
    const Shape = struct({ [key()]: field<number>() });
    function nested(value = 1e400): number { return value; }
    const captured = (): number => nested();
    class Hidden { read(): number { return captured(); } }
    try { for (const name in { value: 1 }) { nested(); } } catch {}
    return new Hidden().read();
  }
  return 42;
}` }, compileTarget(request) {
      context = analyzeRustCheckedContext(request);
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    } });
    assert.equal(result.diagnostics.length, 0, "a complete erased subtree cannot impose native obligations");
    const ast = context.ast;
    const dormant = context.sourceStorage.nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "dormant");
    assert.equal(dormant !== undefined, true, "the checked source keeps the exact erased root");
    assert.equal(context.records.nativeParticipation.get(dormant), "erased", "the canonical owner selects erasure once");
    const subtree = new Set();
    const pending = [dormant];
    while (pending.length !== 0) {
      const node = pending.pop();
      subtree.add(node);
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
    assert.equal(context.nativeNodes.some(node => subtree.has(node)), false, "all descendants share the completed exclusion");
    assert.equal(context.sourceStorage.nodes.some(node => subtree.has(node)), true, "checked source transport is never filtered");
    for (const node of subtree) {
      assert.equal(context.records.runtimeCarrier.get(node) === undefined, true, "no native carrier request for an erased descendant");
      assert.equal(context.records.sourceParameterAbi.get(node) === undefined, true, "no syntax-only parameter ABI request");
    }
  });

  test(`an unused nested enum does not create a native declaration obligation (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused(): number { enum Hidden { Value = 7 } return Hidden.Value; }
  return 42;
}` } });
    assert.equal(result.diagnostics.length, 0, "an enum in an erased body needs no emitted native declaration");
    assert.equal(/\benum Hidden\b/u.test(rustSourceText(result)), false, "no native enum escapes the erased subtree");
  });

  test(`a type-only callable reference preserves its required native signature without demanding its unused body (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function unused(value: number): number { return value + 1; }
  const callback: typeof unused = (value: number): number => value * 2;
  return callback(21);
}` } });
    assert.equal(result.diagnostics.length, 0, "the checked callable type remains usable independently of its source implementation");
    assert.equal(/\bfn unused\b/u.test(rustSourceText(result)), false, "a type reference is not an implementation demand");
  });

  test(`actual default parameters keep their native rejection (${surface})`, () => {
    const { result } = compileRust({ surfaces: selected, files: { "index.ts": `
export function run(): number {
  function required(value = 1e400): number { return value; }
  return required();
}` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_NUMERIC_LITERAL_NOT_FINITE"), true,
      "an actually used default retains its exact native numeric rule");
    assert.equal(result.artifacts.length, 0, "a required invalid default has no partial output");
  });
}
