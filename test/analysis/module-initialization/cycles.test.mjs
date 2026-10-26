import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRustModuleCycles } from "../../../dist/analysis/module-initialization/cycles.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function fixture(left = "export const fromA: number = fromB + 1;", right = "export const fromB: number = fromA + 1;") {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: {
    "/src/a.ts": `import { fromB } from "./b.js"; ${left}`,
    "/src/b.ts": `import { fromA } from "./a.js"; ${right}`,
    "/src/index.ts": "export function main(): void {}",
  }, compilerOptions: { strict: true, target: "es2022", module: "esnext", moduleResolution: "bundler" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the original module graph checks without source errors");
  const source = createTargetSourceProgram(checked);
  const sourceFiles = checked.sourceFiles.filter(file => file !== undefined && !file.IsDeclarationFile);
  const declarations = [];
  const visit = node => {
    if (source.ast.is.IsVariableDeclaration(node)) declarations.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  sourceFiles.forEach(visit);
  const erased = new Set();
  const input = { ast: source.ast, source, sourceFiles,
    records: { compileTimeSource: { get: node => erased.has(node) ? true : undefined } } };
  return { input, declarations, erased };
}

test("source cycle classification publishes one immutable outcome without rejecting unused modules", () => {
  const current = fixture();
  const selected = analyzeRustModuleCycles(current.input);
  assert.equal(selected.kind, "resolved", "classification alone does not admit or reject an initialization root");
  const completed = selected.value.complete();
  assert.equal(completed.length, 1, "the exact imported component has one state-dependent outcome");
  const cycle = completed[0];
  assert.equal(cycle.sourceFiles.length, 2, "the unrelated executable entry is not part of the component");
  assert.equal(Object.isFrozen(completed) && Object.isFrozen(cycle) && Object.isFrozen(cycle.sourceFiles) &&
    Object.isFrozen(cycle.issue), true, "all consumers share immutable original source evidence");
  assert.equal(cycle.issue.code, "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE", "the original precise refusal is retained");
  assert.equal(selected.value.complete() === completed, true, "the completed analysis is a pure immutable lookup");
});

test("actual cross-module binding recursion consumes the original source cycle before generic storage refusal", () => {
  const current = fixture();
  const selected = analyzeRustModuleCycles(current.input);
  assert.equal(selected.kind, "resolved", "the checked source component is classified");
  const diagnostics = [];
  const walk = { moduleCycles: selected.value, context: { ...current.input, diagnostics },
    resolving: new Set(current.declarations), rejectedExpressions: new WeakSet() };
  assert.equal(current.declarations.length, 2, "both original module bindings are present");
  selected.value.rejectActiveBinding(walk, current.declarations[0]);
  selected.value.rejectActiveBinding(walk, current.declarations[1]);
  assert.equal(diagnostics.length, 1, "one component produces one precise diagnostic");
  const completed = selected.value.complete();
  assert.equal(diagnostics[0].code, completed[0].issue.code, "the admitted refusal is the source owner's decision");
  assert.equal(diagnostics[0].sourceNode === completed[0].issue.sourceNode, true, "the exact component source owner is retained");
  assert.equal(current.declarations.every(declaration => walk.rejectedExpressions.has(declaration)), true,
    "the existing terminal-failure owner marks both dependent bindings");
  diagnostics.length = 0;
  walk.resolving = new Set([current.declarations[0]]);
  selected.value.rejectActiveBinding(walk, current.declarations[0]);
  assert.equal(diagnostics.length, 0, "an unrelated same-file active binding is not a cross-module recursion proof");
});

test("function-only and independent initializer cycles retain their original admission", () => {
  for (const source of [
    ["export function fromA(): number { return fromB(); }", "export function fromB(): number { return fromA(); }"],
    ["export const value: number = 1; export function fromA(): number { return fromB() + value; }",
      "export function fromB(): number { return 2; } export function useA(): number { return fromA(); }"],
  ]) {
    const selected = analyzeRustModuleCycles(fixture(...source).input);
    assert.equal(selected.kind, "resolved", "the exact checked graph remains admitted");
    assert.equal(selected.value.complete().length, 0, "no rejected cycle decision is invented for independent initialization");
  }
});

test("erased initializer evidence stays with the existing source cycle independence owner", () => {
  const current = fixture();
  const selected = analyzeRustModuleCycles(current.input);
  assert.equal(selected.kind, "resolved", "the exact checked graph remains classified");
  current.declarations.forEach(declaration => current.erased.add(declaration));
  assert.equal(selected.value.complete().length, 0, "declarations erased after graph discovery do not manufacture runtime state dependence");
});

test("late-erased inline function aliases preserve independent cyclic module initialization", () => {
  const { program } = analyzeRust({ surfaces: [], target: {
    id: "rust", options: { outputType: "bin", crateName: "cycle_inline_aliases" },
  }, files: {
    "a.ts": `import type { int32 } from "@tsonic/core/types.js";
      import { fromB } from "./b.js";
      function ownA(value: int32): int32 { return value + 1; }
      const applyA = ownA;
      export let value: int32 = 4;
      export function fromA(): int32 { return applyA(fromB()) + value; }`,
    "b.ts": `import type { int32 } from "@tsonic/core/types.js";
      import { fromA } from "./a.js";
      function ownB(): int32 { return 3; }
      const applyB = ownB;
      export function fromB(): int32 { return applyB(); }
      export function referenceA(): int32 { return fromA(); }`,
    "index.ts": `import { fromA } from "./a.js";
      export function main(): void { if (fromA() !== 8) throw new Error("cyclic inline alias mismatch"); }
      main();`,
  } });
  const ast = program.source.ast;
  const aliases = [];
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node) && ["applyA", "applyB"].includes(ast.text(ast.name(node)))) aliases.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(aliases.length, 2, "both actual cycle members contain an original inline function alias");
  assert.equal(aliases.every(declaration => program.records.compileTimeSource.get(declaration) === true), true,
    "the existing callable alias owner erases both declarations before cycle completion");
  assert.equal(program.moduleInitialization.moduleCycles.length, 0, "late erasure preserves the original independent-cycle admission");
  const initialized = program.sourceFiles.find(file => ast.getFileName(file).endsWith("/a.ts"));
  assert.equal(initialized !== undefined, true, "the original initializer module remains checked");
  assert.equal(program.moduleInitialization.requirementFor(initialized).kind, "required",
    "the ordinary initialized value still has its real runtime initialization requirement");
});
