import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/calls/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { requireRustRecord } from "../../../dist/analysis/program/records/required-records.js";

function checkedFunctions(text) {
  const { program, source } = analyzeRust({ surfaces: [], files: { "index.ts": text } });
  const { ast } = program.source;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  const named = name => declarations.filter(node => ast.text(ast.name(node)) === name);
  return { program, source, ast, declarations, named };
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
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src",
    compilerOptions: { strict: true, target: "es2022", module: "esnext" },
    files: { "/src/index.ts": `
      export function outer(): void;
      export function outer(): void {
        function unused(): void;
        function unused(): void {}
        function written(): void {}
        function observed(): void {}
        written();
        const retained = [observed];
        void retained;
      }
      export declare function moduleUnresolved(): void;
    ` },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics));
  const source = createTargetSourceProgram(checked);
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  source.navigation.sourceFiles.forEach(visit);
  const functions = nodes.filter(source.ast.is.IsFunctionDeclaration);
  assert.equal(functions.length, 7, "the real checked source has the same seven placement records");
  const named = (name, body) => functions.find(node => source.ast.text(source.ast.name(node)) === name &&
    (source.ast.body(node) !== undefined) === body);
  const readers = ["callableImplementation", "declarationUseSummary", "declarationSymbol", "referencesWithin", "sourceReferenceFor", "getSourceFile"];
  const reads = Object.fromEntries(readers.map(reader => [reader, { before: 0, after: 0 }]));
  let sealed = false;
  let moduleImplementationReads = 0;
  let lexicalImplementationReads = 0;
  const count = reader => { reads[reader][sealed ? "after" : "before"] += 1; };
  const ast = Proxy.revocable({ ...source.ast,
    getSourceFile(node) { count("getSourceFile"); return source.ast.getSourceFile(node); },
    forEachChild() { throw new Error("native participation must use the existing finite source domain"); },
  }, {});
  const navigation = Proxy.revocable({ ...source.navigation,
    ...Object.fromEntries(readers.filter(reader => reader !== "getSourceFile").map(reader => [reader, (...args) => {
      count(reader);
      if (reader === "callableImplementation") {
        const moduleBodyless = source.ast.body(args[0]) === undefined && source.ast.is.IsSourceFile(source.ast.parent(args[0]));
        if (moduleBodyless) moduleImplementationReads += 1;
        else lexicalImplementationReads += 1;
      }
      return source.navigation[reader](...args);
    }])),
  }, {});
  return { ast, navigation, nodes, outer: named("outer", true), moduleSignature: named("outer", false),
    moduleUnresolved: named("moduleUnresolved", false), blockSignature: named("unused", false),
    unused: named("unused", true), written: named("written", true), observed: named("observed", true),
    implementationReads: () => reads.callableImplementation.before,
    moduleImplementationReads: () => moduleImplementationReads,
    lexicalImplementationReads: () => lexicalImplementationReads, reads, markSealed: () => { sealed = true; } };
}

test("native placement closes one finite declaration domain and does not inspect source after sealing", () => {
  const current = placementInputs();
  const builder = createRustProgramRecordBuilder();
  const requiredRecords = [];
  analyzeRustNativeParticipation({ ast: current.ast.proxy, storage: { nodes: current.nodes, failureReason: () => undefined }, navigation: current.navigation.proxy,
    producer: builder.nativeParticipations, requiredRecords });
  const records = builder.seal(requiredRecords);
  current.markSealed();
  assert.equal(requiredRecords.length, 7);
  assert.equal(current.moduleImplementationReads(), 2, "only source-file bodyless declarations need implementation correspondence");
  assert.equal(current.lexicalImplementationReads(), 5, "lexical checked uses retain their exact implementation correspondence");
  assert.equal(current.implementationReads(), 7, "all module and lexical implementation reads are counted");
  for (const [reader, expected] of Object.entries({ getSourceFile: 3, declarationSymbol: 3, referencesWithin: 3,
    declarationUseSummary: 3, sourceReferenceFor: 2 })) {
    assert.equal(current.reads[reader].before, expected, `${reader}: exact complete pre-seal read count`);
  }
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
  for (const [reader, counts] of Object.entries(current.reads)) {
    assert.equal(counts.after, 0, `${reader}: no source read occurs after sealing and proxy revocation`);
  }
});

test("anonymous callable participation is published once from checked creation demand before source revocation", () => {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src",
    compilerOptions: { strict: true, target: "es2022", module: "esnext" },
    files: { "/src/index.ts": `export function run(observe: (value: () => number) => void, branch: boolean): void {
      const unused = () => 1;
      const alias = unused;
      void alias;
      const typeOnly = function() { return 2; };
      type Signature = typeof typeOnly;
      const invoked = () => 3;
      invoked();
      const escaped = () => 4;
      observe(escaped);
      const conditional = () => 5;
      if (conditional as unknown) {}
      const branchVoid = () => 6;
      if (branch) void branchVoid;
      const parent = () => { const nested = () => 6; return nested(); };
      void parent;
    }` },
  }).checkSource();
  assert.equal(checked.diagnostics.length, 0, formatDiagnostics(checked.diagnostics).slice(0, 1024));
  const source = createTargetSourceProgram(checked);
  const storage = createSourceStorageQuery(source, source.navigation.sourceFiles);
  assert.equal(storage.failureReason(), undefined, "the actual checked finite source domain is complete");
  const definitions = new Map(storage.nodes.flatMap(node => {
    if (!source.ast.is.IsVariableDeclaration(node)) return [];
    const expression = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    return expression !== undefined && (source.ast.is.IsArrowFunction(expression) || source.ast.is.IsFunctionExpression(expression))
      ? [[source.ast.text(source.ast.name(node)), expression]] : [];
  }));
  const ast = Proxy.revocable(source.ast, {});
  const navigation = Proxy.revocable(source.navigation, {});
  const builder = createRustProgramRecordBuilder();
  const requiredRecords = [];
  const domain = analyzeRustNativeParticipation({ ast: ast.proxy, navigation: navigation.proxy, storage,
    producer: builder.nativeParticipations, requiredRecords });
  assert.equal(domain.kind, "resolved", "the native owner consumes the same checked domain");
  const records = builder.seal(requiredRecords);
  ast.revoke();
  navigation.revoke();
  assert.equal(requiredRecords.filter(record => record.construct === "anonymous-callable-creation").length, 8,
    "exactly the reached original anonymous definitions have one required record");
  // RULINGS 2026-10-22: an arrow stored in a binding is created, and its captures evaluated, even if the binding is never
  // read, so every stored definition here (read or not) keeps its native body.
  for (const name of ["unused", "typeOnly", "branchVoid", "parent", "nested", "invoked", "escaped", "conditional"]) {
    const declaration = definitions.get(name);
    assert.equal(declaration !== undefined, true, `${name}: original checked creation exists`);
    assert.equal(records.nativeParticipation.get(declaration), "body", `${name}: a stored creation remains native`);
    assert.equal(domain.nodes.includes(declaration), true, `${name}: native demand keeps its original owner`);
  }
  assert.equal(records.nativeParticipation.get({}) === undefined, true, "a foreign node never inherits the creation decision");
});

test("an exhausted actual checked source domain publishes no partial native participation", () => {
  const current = checkedFunctions("export function run(): number { return 3; }");
  const storage = createSourceStorageQuery(createTargetSourceProgram(current.source), current.program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile), {
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
