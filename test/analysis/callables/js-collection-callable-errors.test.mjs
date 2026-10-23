import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustOnlyTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function analyze(collection, read) {
  let program;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function run(): Promise<void> {
  return new Promise<void>((resolve) => {
    ${collection}
    ${read}
  });
}` }, compileTarget(request) {
    const analyzed = analyzeRustAnalysisProgram(request);
    if (analyzed.kind === "rejected") return analyzed;
    program = analyzed.value;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(program !== undefined, true, "the real compiler admits the callback storage and its resolver effect");
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const declaration = nodes.find(node => program.source.ast.is.IsVariableDeclaration(node) &&
    program.source.ast.text(program.source.ast.name(node)) === "callbacks");
  assert.equal(declaration !== undefined, true, "the collection's original storage declaration is present");
  const physical = program.callableValues.nativeStorage.valueFor(declaration);
  assert.equal(physical.kind !== "unresolved", true,
    physical.kind === "unresolved" ? physical.reason : "the existing physical-storage owner closes the aggregate once");
  return rustOnlyTypeGenericArguments(physical.carrier.genericArguments);
}

for (const [label, collection, read, slot] of [
  ["array", "const callbacks: Array<() => void> = [() => resolve()];", "callbacks.forEach(callback => callback());", 0],
  ["set", "const callbacks = new Set<() => void>([() => resolve()]);", "callbacks.forEach(callback => callback());", 0],
  ["map", "const callbacks = new Map<string, () => void>([[\"ready\", () => resolve()]]);",
    "callbacks.forEach(callback => callback());", 1],
  ["set with later alias write", `const callbacks = new Set<() => void>();
    const alias = callbacks; alias.add(() => resolve());`, "callbacks.forEach(callback => callback());", 0],
  ["map with later alias write", `const callbacks = new Map<string, () => void>();
    const alias = callbacks; alias.set("ready", () => resolve());`, "callbacks.forEach(callback => callback());", 1],
]) test(`a JS ${label} slot retains its actual resolver callback's JsValue error`, () => {
  const arguments_ = analyze(collection, read);
  const callback = arguments_?.[slot];
  assert.equal(callback !== undefined, true, "the checked receiver type-argument slot has one selected physical element");
  const signature = rustCallablePhysicalSignature(callback);
  assert.equal(signature !== undefined, true, "the stored callback has its canonical native invocation ABI");
  assert.equal(signature.parameters.length, 0, "the callback's zero-argument source signature is unchanged");
  assert.equal(rustTargetTypeRefEquals(signature.error, rustJsValueTargetType()), true,
    "a sole resolver producer is stored with JsValue directly, with no TsonicError conversion or error allocation");
  if (slot === 1) assert.equal(rustCallablePhysicalSignature(arguments_[0]) === undefined, true,
    "selecting the value slot does not rewrite the unrelated Map key carrier");
});
