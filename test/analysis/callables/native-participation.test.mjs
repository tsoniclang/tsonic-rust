import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { requireRustRecord } from "../../../dist/analysis/program/records/required-records.js";

function checkedFunctions(text) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const { ast } = program.source;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const named = name => declarations.filter(node => ast.text(ast.name(node)) === name);
  return { program, ast, declarations, named };
}

test("native named-function placement retains exact overload bodies and checked lexical uses", () => {
  const current = checkedFunctions(`
    export function scale(value: number): number;
    export function scale(value: number, factor: number): number;
    export function scale(value: number, factor: number = 2): number { return value * factor; }
    export function run(value: number): number {
      function unused(): number { return 7; }
      function typeOnly(): number { return 8; }
      type Signature = typeof typeOnly;
      function captured(): number { return value; }
      return scale(captured());
    }
  `);
  const family = current.program.records.nativeParticipation;
  assert.equal(family !== undefined, true, "analysis publishes native function placement");
  assert.deepEqual(current.named("scale").map(node => family.get(node)), ["erased", "erased", "body"]);
  for (const name of ["run", "captured"]) assert.equal(family.get(current.named(name)[0]), "body", name);
  for (const name of ["unused", "typeOnly"]) assert.equal(family.get(current.named(name)[0]), "erased", name);
});

test("native named-function placement publishes immutable exact source identities", () => {
  const current = checkedFunctions("export function run(): number { return 3; }");
  const family = current.program.records.nativeParticipation;
  assert.equal(family !== undefined, true, "analysis publishes the sole get-only family");
  assert.deepEqual(Object.keys(family), ["get"]);
  assert.equal(Object.isFrozen(family), true);
  const declaration = current.named("run")[0];
  assert.equal(family.get(declaration), "body");
  assert.equal(family.get(declaration), family.get(declaration));
  assert.equal(family.get(undefined) === undefined, true);
  assert.equal(family.get({}) === undefined, true);
  const foreign = Object.defineProperty({}, "parent", { get() { throw new Error("foreign source inspection"); } });
  assert.equal(family.get(foreign) === undefined, true);
});

function placementInputs() {
  const file = {};
  const block = {};
  const outer = {};
  const moduleSignature = {};
  const moduleUnresolved = {};
  const blockSignature = {};
  const unused = {};
  const written = {};
  const observed = {};
  const parents = new Map([[block, file], [outer, file], [moduleSignature, file], [moduleUnresolved, file],
    [blockSignature, block], [unused, outer], [written, outer], [observed, outer]]);
  const functions = [outer, moduleSignature, moduleUnresolved, blockSignature, unused, written, observed];
  const functionSet = new Set(functions);
  const bodies = new Set([outer, unused, written, observed]);
  const ast = Proxy.revocable({
    parent: node => parents.get(node),
    body: node => bodies.has(node) ? {} : undefined,
    kindName: node => functionSet.has(node) ? "KindFunctionDeclaration" : node === file ? "KindSourceFile" : "KindBlock",
    is: { IsFunctionDeclaration: node => functionSet.has(node), IsSourceFile: node => node === file,
      IsArrowFunction: () => false, IsFunctionExpression: () => false },
    forEachChild() { throw new Error("native participation must use the existing finite source domain"); },
  }, {});
  let implementationReads = 0;
  const navigation = Proxy.revocable({
    callableImplementation(node) {
      implementationReads += 1;
      return node === moduleSignature ? { kind: "resolved", implementation: { declaration: outer } }
        : { kind: "unresolved", reason: "body not resolved" };
    },
    declarationUseSummary(node) {
      return { exported: false, bindingWritten: node === written, hasUnclassifiedValueUse: node === observed,
        uses: [{ kind: "type-only" }] };
    },
  }, {});
  return { ast, navigation, nodes: [file, block, ...functions], outer, moduleSignature, moduleUnresolved,
    blockSignature, unused, written, observed, implementationReads: () => implementationReads };
}

test("native placement closes one finite declaration domain and does not inspect source after sealing", () => {
  const current = placementInputs();
  const builder = createRustProgramRecordBuilder();
  const requiredRecords = [];
  analyzeRustNativeParticipation({ ast: current.ast.proxy, storage: { nodes: current.nodes, failureReason: () => undefined }, navigation: current.navigation.proxy,
    producer: builder.nativeParticipations, requiredRecords });
  const records = builder.seal(requiredRecords);
  assert.equal(requiredRecords.length, 7);
  assert.equal(current.implementationReads(), 2, "only source-file bodyless declarations need implementation correspondence");
  current.ast.revoke();
  current.navigation.revoke();
  for (const node of [current.outer, current.moduleUnresolved, current.written, current.observed]) {
    assert.equal(records.nativeParticipation.get(node), "body");
  }
  for (const node of [current.moduleSignature, current.blockSignature, current.unused]) {
    assert.equal(records.nativeParticipation.get(node), "erased");
  }
  assert.equal(records.nativeParticipation.get(current.nodes[0]) === undefined, true, "non-callable nodes stay absent");
  assert.equal(records.nativeParticipation.get({}) === undefined, true);
  assert.throws(() => builder.nativeParticipations.selected(current.outer, "body"), /after analysis is sealed/u);
});

test("an exhausted actual checked source domain publishes no partial native participation", () => {
  const current = checkedFunctions("export function run(): number { return 3; }");
  const storage = createSourceStorageQuery(current.program.source, current.program.sourceFiles, {
    maximumNodes: 1, maximumEdges: 262144, maximumSubjectRows: 1048576,
    maximumTransportRows: 4194304, maximumSteps: 33554432,
  });
  assert.equal(storage.failureReason() !== undefined, true, "the real checked transport exhausts its tiny node budget");
  const builder = createRustProgramRecordBuilder();
  const requiredRecords = [];
  const forbidden = new Proxy({}, { get() { throw new Error("partial source classification is forbidden"); } });
  const participation = analyzeRustNativeParticipation({ ast: forbidden, storage, navigation: forbidden,
    producer: builder.nativeParticipations, requiredRecords });
  assert.equal(participation.kind, "unresolved", "a parent-closed prefix cannot become a complete native domain");
  assert.equal(participation.reason, storage.failureReason(), "the original finite budget reason is preserved");
  assert.equal(requiredRecords.length, 0, "no native requirement is created from the truncated domain");
  for (const declaration of current.declarations)
    assert.equal(builder.nativeParticipation.get(declaration) === undefined, true, "no partial declaration is published");
  assert.equal(Object.hasOwn(participation, "nodes"), false, "an unresolved result cannot expose partial native nodes");
});

test("native participation has one strict producer and preserves inherited plan isolation", () => {
  const declaration = {};
  const parent = createRustProgramRecordBuilder();
  parent.nativeParticipations.selected(declaration, "body");
  assert.throws(() => parent.nativeParticipations.selected(declaration, "body"), /Duplicate Rust semantic plan/u);
  const child = createRustProgramRecordBuilder(undefined, parent);
  assert.equal(child.nativeParticipation.get(declaration), "body");
  assert.throws(() => child.nativeParticipations.selected(declaration, "erased"), /Conflicting Rust semantic plan/u);
  child.nativeParticipations.selected(declaration, "body");
  const selected = {};
  child.nativeParticipations.selected(selected, "erased");
  assert.equal(parent.nativeParticipation.get(selected) === undefined, true);
  const records = child.seal([]);
  assert.equal(records.nativeParticipation.get(selected), "erased");
  assert.equal(Object.isFrozen(records.nativeParticipation), true);
  assert.equal(Object.hasOwn(records.nativeParticipation, "set"), false);
  assert.throws(() => child.nativeParticipations.selected({}, "body"), /after analysis is sealed/u);
  assert.equal(parent.seal([]).nativeParticipation.get(declaration), "body");
});

test("native participation must satisfy the exact required declaration before publication", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const requiredRecords = [];
  requireRustRecord(requiredRecords, "nativeParticipation", declaration, "named-function-placement", "nativeParticipations.selected");
  assert.throws(() => builder.seal(requiredRecords), /Required Rust semantic plan 'nativeParticipation'/u);
  builder.nativeParticipations.selected(declaration, "body");
  assert.equal(builder.seal(requiredRecords).nativeParticipation.get(declaration), "body");
});
