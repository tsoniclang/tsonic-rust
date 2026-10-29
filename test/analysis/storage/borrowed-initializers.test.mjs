import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { borrowedNullishSequencesSource } from "../../../../tsonic/test/fixtures/borrowed-nullish-sequences.mjs";
import { createTsonicPlugin } from "../../../../rust-nodejs/dist/index.js";
import { analyzeRustBorrowedInitializers } from "../../../dist/analysis/storage/borrowed-initializers.js";
import { createRustBorrowedInitializerProducer } from "../../../dist/analysis/program/records/storage/borrowed-initializers.js";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";
import { recursiveOptionalCollectionUnionFiles } from "../../../../tsonic/test/fixtures/recursive-source-unions.mjs";
import { analyzeRustSourceCallArguments } from "../../../dist/analysis/callables/calls/source-call-arguments.js";
import { createRustSourceCallArgumentProducer } from "../../../dist/analysis/program/records/calls/source-call-arguments.js";

const owningSource = `
import { owner } from "@borrowed-initializer/proof";
export function retainOwner(): number {
  const ownedView = owner().view;
  return ownedView.value;
}
`;

test("a physical local argument requires its exact retained declaration, referent and lifetime", () => {
  const { program } = analyzeRust({ surfaces: [], files: recursiveOptionalCollectionUnionFiles });
  const { ast } = program.source;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const declaration = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "present");
  assert.equal(declaration !== undefined, true, "the actual retained native optional result exists");
  const local = program.records.localBinding.get(declaration);
  assert.equal(local?.kind, "value", "the result has a completed local native binding");
  const initializer = Node_Initializer(ast, declaration);
  const retained = program.records.borrowedInitializer.get(initializer);
  assert.equal(retained?.loan !== undefined, true, "the same initializer owns its physical loan");
  const argument = nodes.find(node => ast.is.IsIdentifier(node) && program.records.sourceBinding.get(node)?.sourceDeclaration === declaration &&
    ast.is.IsCallExpression(ast.parent(node)));
  assert.equal(argument !== undefined, true, "the original count call consumes the exact local result");
  const call = ast.parent(argument);
  const selected = createRustSourceCallArgumentProducer(() => {});
  const issues = analyzeRustSourceCallArguments(program, [call], selected, program.source);
  assert.equal(issues.length, 0, "the completed physical reference enters the matching shared parameter unchanged");
  const fact = program.records.targetOperation.get(call);
  assert.equal(selected.records.sourceCallParameters.get(fact)?.[0]?.inputs[0]?.passing, "identity",
    "the already-borrowed local is not borrowed a second time");
  for (const label of ["foreign declaration", "missing loan", "wrong referent", "wrong lifetime"]) {
    const physical = label === "wrong referent" ? { ...local.nativeCarrier, referent: { kind: "source-primitive", name: "bool" } }
      : label === "wrong lifetime" ? { ...local.nativeCarrier, lifetime: { kind: "static" } } : local.nativeCarrier;
    const records = createRustRecordFixture({ localBinding: { get: node => node === declaration ? { ...local, nativeCarrier: physical }
      : program.records.localBinding.get(node) }, borrowedInitializer: { get: node => node !== initializer
      ? program.records.borrowedInitializer.get(node) : label === "missing loan" ? undefined
      : label === "foreign declaration" ? { ...retained, loan: { ...retained.loan, declaration: call } } : retained } }, program.records);
    const refused = createRustSourceCallArgumentProducer(() => {});
    const failures = analyzeRustSourceCallArguments({ ...program, records }, [call], refused, program.source);
    assert.equal(failures.length, 1, `${label}: the physical input mismatch is rejected once`);
    assert.equal(failures[0].code, "RUST_MISSING_TARGET_FACT", `${label}: invalid evidence does not manufacture reference identity`);
  }
});

test("declaration-owned optional results retain each exact temporary through their local binding", () => {
  const { program } = analyzeRust({ surfaces: [], files: recursiveOptionalCollectionUnionFiles });
  const { ast } = program.source;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node) && ["absent", "present"].includes(ast.text(ast.name(node)))) declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declarations.length, 2, "both original guarded caller initializers are present");
  for (const declaration of declarations) {
    const initializer = Node_Initializer(ast, declaration);
    const selected = program.records.borrowedInitializer.get(initializer);
    const optional = program.records.optionalChainEmission.get(initializer);
    const local = program.records.localBinding.get(declaration);
    const label = ast.text(ast.name(declaration));
    assert.equal(selected?.loan !== undefined, true, `${label}: the original declaration loan is retained`);
    assert.equal(selected.loan.declaration === declaration && selected.loan.initializer === initializer, true,
      `${label}: physical storage belongs to this exact initializer and declaration`);
    assert.equal(selected.loan.guard === program.records.optionalChain.get(initializer).guard, true,
      `${label}: the physical owner is associated with this exact evaluated guard`);
    assert.equal(selected.retained.length, 1, `${label}: one temporary owner is retained, not a recursive payload copy`);
    assert.equal(selected.retained[0].expression === selected.receiver, true, `${label}: the retained owner is the actual input argument`);
    const evaluation = program.records.sourceCallEvaluation.get(selected.loan.guard);
    const argument = evaluation?.arguments.find(value => value.expression === selected.receiver);
    assert.equal(argument?.borrow, "ref", `${label}: the exact native stored owner is borrowed before any value snapshot`);
    assert.equal(argument.retainedOwner?.initializer === initializer, true, `${label}: evaluation retains the same initializer association`);
    assert.equal(argument.retainedOwner?.declaration === declaration, true, `${label}: evaluation retains the enclosing declaration`);
    assert.equal(argument.retainedOwner?.guard === selected.loan.guard, true, `${label}: evaluation belongs to the same checked call`);
    assert.equal(argument.retainedOwner?.parameter === selected.loan.parameter, true, `${label}: the original declared loan parameter is unchanged`);
    assert.equal(optional?.loan?.owner === selected.receiver, true, `${label}: optional emission consumes that same native owner`);
    assert.equal(program.records.valueProjection.get(initializer)?.resultForm, "shared-reference",
      `${label}: the final expression result is the sealed reference, not a place that needs another borrow`);
    assert.equal(local?.kind, "value", `${label}: a concrete local native value is published`);
    assert.equal(rustTargetTypeRefEquals(local.nativeCarrier, selected.loan.resultCarrier), true,
      `${label}: the local binding retains the exact physical reference rather than the logical value carrier`);
    assert.equal(rustTargetTypeRefEquals(local.carrier, selected.loan.resultCarrier.referent), true,
      `${label}: logical type and physical borrowed storage remain distinct`);
    assert.equal(Object.isFrozen(selected.retained), true, `${label}: retained evaluation order is immutable`);
    const records = createRustRecordFixture({ selectedCall: {
      get: node => node === selected.loan.guard ? undefined : program.records.selectedCall.get(node),
    } }, program.records);
    const producer = createRustBorrowedInitializerProducer(() => {});
    analyzeRustBorrowedInitializers(ast, [declaration], records, program.ownership.reads, producer);
    assert.equal(producer.records.get(initializer) === undefined, true,
      `${label}: a missing exact selected declaration cannot create a temporary-owner loan`);
  }
});

function owningProvider() {
  const moduleSpecifier = "@borrowed-initializer/proof";
  const owner = { kind: "target-named", id: "borrowed-initializer.Owner" };
  const view = { kind: "target-named", id: "borrowed-initializer.View", genericArguments: [
    { kind: "lifetime", lifetime: { kind: "placeholder" } },
  ] };
  const number = { kind: "source-primitive", name: "float64" };
  return createRustProviderPackage({ id: "borrowed-initializer-proof", displayName: "Borrowed initializer proof", version: "1",
    modules: [{ moduleSpecifier, providerModuleId: "borrowed-initializer.proof", exports: [
      { id: "Owner", name: "Owner", kind: "interface", members: [
        { id: "Owner.view", name: "view", kind: "property", readonly: true,
          type: { kind: "provider-ref", moduleSpecifier, exportName: "View" } },
      ] },
      { id: "View", name: "View", kind: "interface", members: [
        { id: "View.value", name: "value", kind: "property", readonly: true, type: { kind: "number" } },
      ] },
      { id: "owner", name: "owner", kind: "function", signatures: [{ id: "owner.signature", parameters: [],
        returnType: { kind: "provider-ref", moduleSpecifier, exportName: "Owner" } }] },
    ] }],
    types: [{ exportId: "Owner", targetCarrier: owner }, { exportId: "View", targetCarrier: view }],
    carrierPaths: { [owner.id]: "crate::index::view_probe::Owner", [view.id]: "crate::index::view_probe::View" },
    crates: [], operations: [
      { exportId: "owner", operationKind: "method", target: { form: "call", path: "crate::index::view_probe::owner" }, resultCarrier: owner },
      { exportId: "Owner", memberId: "Owner.view", operationKind: "property", target: { form: "receiver-method", name: "view" },
        receiverCarrier: owner, resultCarrier: view },
      { exportId: "View", memberId: "View.value", operationKind: "property", target: { form: "receiver-method", name: "value" },
        receiverCarrier: view, resultCarrier: number },
    ] });
}

for (const surfaces of [[], ["js"]]) {
  test(`native method elision retains the exact initializer receiver (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, packages: [owningProvider()], capabilities: [createTsonicPlugin()],
      files: { "index.ts": borrowedNullishSequencesSource + owningSource } });
    const { ast } = program.source;
    const initializers = [];
    const nativeNodes = [];
    let owningInitializer;
    const visit = node => {
      nativeNodes.push(node);
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "values")
        initializers.push(ast.as.AsVariableDeclaration(node).Initializer);
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "ownedView")
        owningInitializer = ast.as.AsVariableDeclaration(node).Initializer;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(initializers.length, 3);
    for (const [index, initializer] of initializers.entries()) {
      const operation = program.records.targetOperation.get(initializer);
      assert.equal(operation?.kind, "provider-operation");
      assert.equal(operation.abi.sourceReceiver.kind, "receiver");
      assert.equal(operation.abi.targetReceiver.kind, "input");
      assert.equal(operation.abi.targetReceiver.input.source.kind, "receiver");
      assert.equal(rustTargetTypeRefEquals(operation.abi.sourceReceiver.carrier,
        operation.abi.targetReceiver.input.sourceCarrier), true,
        "each nested receiver retains its exact checked source-to-native identity");
      const receiver = ast.as.AsElementAccessExpression(initializer).Expression;
      const read = program.ownership.reads.get(receiver);
      assert.equal(read.readsStorage, true, "the actual native header receiver already has stable borrowed storage");
      assert.equal(read.source.kind, ["copy", "borrow", "borrow"][index]);
      assert.equal(operation.abi.targetReceiver.input.sourceCarrier.kind, "reference");
      assert.equal(operation.abi.targetReceiver.input.sourceCarrier.mutable, false);
      for (const carrier of [operation.abi.result.carrier, operation.abi.result.rawCarrier])
        assert.equal(rustTargetGenericReferences(carrier).elisionInputs.some(lifetime => lifetime.kind === "placeholder"), true);
      assert.equal(program.records.borrowedInitializer.get(initializer) === undefined, true,
        "an existing native receiver loan does not materialize a second owner binding");
    }
    assert.equal(owningInitializer !== undefined, true, "the same checked program contains a genuinely owned temporary receiver");
    const selection = program.records.borrowedInitializer.get(owningInitializer);
    const receiver = ast.as.AsPropertyAccessExpression(owningInitializer).Expression;
    assert.equal(selection !== undefined, true, "an actual owned temporary still retains its exact native lifetime owner");
    assert.equal(selection.receiver === receiver, true);
    assert.equal(program.ownership.reads.get(receiver).readsStorage, false);
    assert.equal(rustTargetTypeRefEquals(selection.carrier,
      program.records.targetOperation.get(owningInitializer).abi.targetReceiver.input.sourceCarrier), true);
    assert.equal(Object.isFrozen(selection), true);
    assert.equal(Object.isFrozen(program.records.borrowedInitializer), true);
    const initializer = owningInitializer;
    const fact = program.records.targetOperation.get(initializer);
    const input = fact.abi.targetReceiver.input;
    const invalid = [
      { ...fact, abi: { ...fact.abi, targetReceiver: { kind: "none" } } },
      { ...fact, abi: { ...fact.abi, target: { form: "call", path: "foreign" } } },
      { ...fact, abi: { ...fact.abi, targetReceiver: { kind: "input", input: { ...input, mode: "by-value" } } } },
      { ...fact, abi: { ...fact.abi, result: { ...fact.abi.result, carrier: { kind: "source-primitive", name: "string" } } } },
      { ...fact, abi: { ...fact.abi, result: { ...fact.abi.result,
        rawCarrier: { kind: "reference", mutable: false, referent: { kind: "source-primitive", name: "string" }, lifetime: { kind: "static" } } } } },
    ];
    for (const mutation of [undefined, ...invalid]) {
      const records = createRustRecordFixture({
targetOperation: { get: (node) => {
    return node === initializer ? mutation : program.records.targetOperation.get(node);
} }}, program.records);
      const selected = createRustBorrowedInitializerProducer(() => {});
      analyzeRustBorrowedInitializers(ast, nativeNodes, records,
        program.ownership.reads, selected);
      assert.equal(selected.records.get(initializer) === undefined, true, "missing or incompatible borrowing evidence is never manufactured");
    }
  });
}

test("a native borrowed initializer evaluates and drops its owned receiver exactly once", { timeout: 300_000 }, () => {
  const { result } = compileRust({ packages: [owningProvider()], files: { "index.ts": owningSource },
    target: { id: "rust", options: { outputType: "lib", crateName: "borrowed_initializer_owner" } } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  const native = `
pub mod view_probe {
    use std::sync::atomic::{AtomicUsize, Ordering};
    pub static CREATED: AtomicUsize = AtomicUsize::new(0);
    pub static DROPPED: AtomicUsize = AtomicUsize::new(0);
    pub struct Owner { value: f64 }
    pub struct View<'a> { owner: &'a Owner }
    pub fn owner() -> Owner {
        CREATED.fetch_add(1, Ordering::SeqCst);
        Owner { value: 7.0 }
    }
    impl Owner {
        pub fn view(&self) -> View<'_> { View { owner: self } }
    }
    impl View<'_> {
        pub fn value(&self) -> f64 { self.owner.value }
    }
    impl Drop for Owner {
        fn drop(&mut self) { DROPPED.fetch_add(1, Ordering::SeqCst); }
    }
}
#[cfg(test)]
mod retention {
    use super::{retainOwner, view_probe};
    use std::sync::atomic::Ordering;
    #[test]
    fn owning_receiver_is_retained_until_the_borrowed_view_is_consumed() {
        assert_eq!(retainOwner(), 7.0);
        assert_eq!(view_probe::CREATED.load(Ordering::SeqCst), 1);
        assert_eq!(view_probe::DROPPED.load(Ordering::SeqCst), 1);
    }
}
`;
  const root = writeGeneratedProject("borrowed-initializer-owner",
    result.artifacts.map(artifact => artifact.path === "src/index.rs" ? { ...artifact, text: artifact.text + native } : artifact));
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt"]);
  runCargo(root, ["fmt", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});
