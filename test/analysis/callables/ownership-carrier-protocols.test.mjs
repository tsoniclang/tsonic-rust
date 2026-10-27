import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { selectRustCallableOwnershipCarrier } from "../../../dist/analysis/callables/ownership/ownership-carriers.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustCallableProtocol, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStaticLifetime } from "../../../dist/target-model/lifetimes/index.js";
import { rustJsValueTargetType, rustProgramErrorTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { compileRust } from "../../helpers/rust-session.mjs";

const value = { kind: "source-primitive", name: "int32" };
const parameter = { kind: "type-parameter", identity: "owned:T", name: "T" };
const origin = { fileName: "/owned.ts", declarationIdentity: "1:2" };
const carriers = [
  { kind: "function-pointer", abi: "C", args: [value], result: value },
  ...["Fn", "FnMut", "FnOnce"].map(callTrait =>
    ({ kind: "closure", callTrait, args: [value], result: value, fallible: true })),
  rustGenericCallableTargetType([parameter], [parameter], parameter, origin),
];

function input(carrier, selection) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/protocol", files: {
    "/protocol/index.ts": "const callback = (): number => 0;",
  }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/protocol/index.ts");
  assert.equal(file !== undefined, true);
  const storage = createSourceStorageQuery(source, [file]);
  const node = storage.nodes.find(candidate => source.ast.is.IsVariableDeclaration(candidate));
  const subject = storage.subjectFor(node);
  const scope = storage.bindingsForLexicalOwner(node);
  assert.equal(subject.kind === "resolved" && scope.kind === "resolved", true);
  return {
    ast: {}, logicalCarrier: carrier,
    formalInputFor: () => undefined,
    source: { subject: subject.subject, bindings: scope.bindings },
    selection: { kind: "storage", producers: storage.storageProducersFor(subject.subject, scope.bindings) },
    ownership: { failureReason: () => selection.kind === "unresolved" ? selection.reason : undefined,
      activationForCallable: () => selection.kind === "frame" ? selection.activation : undefined,
      isCyclicCallable: () => false, isCyclicSlot: () => false },
    environmentFor: () => assert.fail("ordinary storage must not select a frame environment"),
    classFrameFor: () => assert.fail("ordinary storage must not select a class frame instantiation"),
  };
}

test("ordinary native and generic callables preserve their exact authored protocol without a wrapper", () => {
  for (const carrier of carriers) {
    assert.equal(carrier !== undefined, true, "well-formed native callable control");
    const result = selectRustCallableOwnershipCarrier(input(carrier, { kind: "ordinary" }));
    assert.equal(result.kind, "selected");
    assert.equal(result.carrier === carrier, true, "native ABI, call trait, fallibility and binder remain unchanged");
  }
});

test("native callable protocol support never bypasses unresolved ownership or quantified frame rejection", () => {
  for (const carrier of carriers) {
    const result = selectRustCallableOwnershipCarrier(input(carrier,
      { kind: "unresolved", reason: "exact ownership is missing" }));
    assert.equal(result.kind, "unresolved");
    assert.equal(result.reason, "exact ownership is missing");
  }
  const generic = carriers[carriers.length - 1];
  const frame = selectRustCallableOwnershipCarrier(input(generic, { kind: "frame", activation: {} }));
  assert.equal(frame.kind, "unresolved");
  assert.match(frame.reason, /quantified frame/u);
  const invalid = selectRustCallableOwnershipCarrier(input(value, { kind: "ordinary" }));
  assert.equal(invalid.kind, "unresolved", "an ordinary value is not a callable protocol");
});

function formalInputs() {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/formal", files: {
    "/formal/index.ts": `export function select(callback: (value: number) => number, other: (value: number) => number, flag: boolean) {
      let selected = callback; if (flag) selected = other; return selected;
    }`,
  }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
  assert.equal(checked.diagnostics.length, 0, "the real formal/alias/mutable-write source is checked");
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/formal/index.ts");
  assert.equal(file !== undefined, true, "the original source file exists");
  const storage = createSourceStorageQuery(source, [file]);
  const declaration = storage.nodes.find(node => source.ast.is.IsVariableDeclaration(node));
  const subject = storage.storageSubjectFor(declaration);
  const scope = storage.bindingsForLexicalOwner(declaration);
  assert.equal(subject.kind === "resolved" && scope.kind === "resolved", true, "the original variable has its exact storage context");
  const producers = storage.storageProducersFor(subject.subject, scope.bindings);
  assert.equal(producers.kind, "open", "source values remain open at their external native inputs");
  assert.equal(producers.producers.length, 2, "both the initial value and the later write are retained");
  assert.equal(producers.boundaries.length, 2, "neither external input boundary is discarded");
  const scalar = { kind: "source-primitive", name: "float64" };
  const physical = rustCallableTargetType([scalar], scalar, rustStaticLifetime, rustJsValueTargetType());
  const logical = rustCallableTargetType([scalar], scalar);
  const carriers = new Map(producers.producers.map(origin => [origin.subject.node, physical]));
  return { producers, storage, physical, logical, carriers, request: {
    ast: source.ast, source: { subject: subject.subject, bindings: scope.bindings },
    selection: { kind: "storage", producers }, logicalCarrier: logical,
    ownership: { failureReason: () => undefined, activationForCallable: () => undefined,
      isCyclicCallable: () => false, isCyclicSlot: () => false },
    formalInputFor: origin => carriers.get(origin.subject.node),
    environmentFor: () => assert.fail("a typed native formal does not create a frame environment"),
    classFrameFor: () => assert.fail("a typed native formal does not create a class frame"),
  } };
}

test("formal physical callable inputs close only their own boundaries without closing source values", () => {
  const current = formalInputs();
  const selected = selectRustCallableOwnershipCarrier(current.request);
  assert.equal(selected.kind, "selected", selected.reason);
  assert.equal(selected.carrier === current.physical, true, "the exact native JsValue/static ABI is retained, not source signature defaults");
  assert.equal(current.request.selection.producers === current.producers, true, "the existing source domain is never replaced");
  assert.equal(current.producers.kind, "open", "the value domain still has its external-input provenance");
  assert.equal(current.producers.boundaries.length, 2, "all source boundaries remain visible to other consumers");
});

test("formal physical callable selection requires every write and exact native ABI", () => {
  const current = formalInputs();
  const first = current.producers.producers[0];
  const second = current.producers.producers[1];
  current.carriers.delete(second.subject.node);
  assert.equal(selectRustCallableOwnershipCarrier(current.request).kind, "unresolved", "the later write cannot disappear behind the first formal");
  current.carriers.set(second.subject.node, current.logical);
  assert.equal(selectRustCallableOwnershipCarrier(current.request).kind, "unresolved", "different native error/lifetime contracts cannot silently merge");
  current.carriers.set(second.subject.node, rustCallableTargetType([], { kind: "tuple", elements: [] }, rustStaticLifetime, rustProgramErrorTargetType()));
  assert.equal(selectRustCallableOwnershipCarrier(current.request).kind, "unresolved", "a different invocation vector is not formal closure");
  current.carriers.set(second.subject.node, current.physical);
  const absent = { ...current.request, formalInputFor: () => undefined };
  assert.equal(selectRustCallableOwnershipCarrier(absent).kind, "unresolved", "missing original formal ABI is never recovered from the signature");
  for (const kind of ["external-write", "opaque-write", "opaque-result", "unclassified-exposure"]) {
    const producers = { ...current.producers, boundaries: [{ ...current.producers.boundaries[0], kind }, ...current.producers.boundaries.slice(1)] };
    assert.equal(selectRustCallableOwnershipCarrier({ ...current.request, selection: { kind: "storage", producers } }).kind,
      "unresolved", `${kind}: a typed formal cannot waive a different exposure`);
  }
  const other = formalInputs();
  const foreign = { ...current.producers, boundaries: [other.producers.boundaries[0], ...current.producers.boundaries.slice(1)] };
  assert.equal(selectRustCallableOwnershipCarrier({ ...current.request, selection: { kind: "storage", producers: foreign } }).kind,
    "unresolved", "a structurally identical foreign formal is not the original source subject");
  const foreignBindings = { ...current.producers, boundaries: [
    { ...current.producers.boundaries[0], bindings: other.producers.boundaries[0].bindings }, ...current.producers.boundaries.slice(1)] };
  assert.equal(selectRustCallableOwnershipCarrier({ ...current.request, selection: { kind: "storage", producers: foreignBindings } }).kind,
    "unresolved", "a different original activation cannot discharge the same-spelled formal boundary");
  assert.equal(first.subject !== second.subject, true, "the two retained native formal identities remain distinct");
});

test("stored contextual native formals retain their declared physical error and lifetime", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
function helper<Value>(value: Value) { return new Promise<Value>(resolve => {
  const cell = { done: resolve }; const alias = cell.done; alias(value);
}); }
export function ordinary(value: number): void { void helper(value); }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(issue => issue.message).join("\n"));
  assert.equal(result.program !== undefined && result.artifacts.length > 0, true, "the exact ordinary program is fully admitted");
  const program = result.program;
  const ast = program.source.ast;
  let parameter;
  let alias;
  const visit = node => {
    const name = ast.name(node);
    if (name !== undefined && ast.is.IsIdentifier(name)) {
      if (ast.is.IsParameterDeclaration(node) && ast.text(name) === "resolve") parameter = node;
      if (ast.is.IsVariableDeclaration(node) && ast.text(name) === "alias") alias = node;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(parameter !== undefined && alias !== undefined, true, "the authored formal and stored alias are retained");
  const formal = program.records.sourceParameterAbi.get(parameter);
  const protocol = rustCallableProtocol(formal?.valueCarrier);
  assert.equal(formal?.form, "required", "the original formal owns the published ABI");
  assert.equal(formal.mode, "value", "no borrowed input is silently made owning");
  assert.equal(protocol?.lifetime?.kind, "static", "the exact existing formal storage lifetime is retained");
  assert.equal(rustTargetTypeRefEquals(protocol?.error, rustJsValueTargetType()), true,
    "the existing native JsValue rejection carrier is not replaced by signature-default program error");
  assert.equal(rustTargetTypeRefEquals(program.records.runtimeCarrier.get(alias)?.carrier, formal.valueCarrier), true,
    "the data field and alias read preserve the same selected physical native formal ABI");
});
