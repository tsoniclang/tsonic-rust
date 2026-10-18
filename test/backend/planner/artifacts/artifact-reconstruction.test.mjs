import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRustSourceFile,
} from "../../../../dist/backend/target-ast/syntax/nodes.js";
import {
  rustSourceFileContractCandidate,
} from "../../../../dist/backend/planner/artifacts/source-file-contract.js";
import { reconstructRustSourceFiles } from "../../../../dist/backend/planner/artifacts/reconstruction.js";
import { createRustArtifactGraph } from "../../../../dist/backend/planner/artifacts/graph.js";

test("Rust artifact contracts separate public signatures from implementation", () => {
  const first = contractFor(functionItem("i32", "1"));
  const bodyChanged = contractFor(functionItem("i32", "2"));
  const signatureChanged = contractFor(functionItem("i64", "1"));

  assert.equal(
    facet(first, "source-file-public-surface"),
    facet(bodyChanged, "source-file-public-surface"),
  );
  assert.notEqual(
    facet(first, "source-file-implementation"),
    facet(bodyChanged, "source-file-implementation"),
  );
  assert.notEqual(
    facet(first, "source-file-public-surface"),
    facet(signatureChanged, "source-file-public-surface"),
  );
});

function reconstructionFixture() {
  const sourceFile = { fileName: "/project/index.ts" };
  const identity = { fileName: sourceFile.fileName, moduleName: "index", moduleSegments: ["index"],
    componentId: "root", childModuleNames: [], relativeSourcePath: "index.ts", packageId: "root" };
  const program = { sourceFiles: [sourceFile], source: { ast: {
    getFileName: file => file.fileName, getPath: file => file.fileName,
  } } };
  return { sourceFile, program, identity, components: [{ componentId: "root", root: true }],
    identities: new Map([[sourceFile.fileName, identity]]), artifacts: createRustArtifactGraph() };
}

function reconstructFixture(current, diagnostics) {
  return reconstructRustSourceFiles({ program: current.program, artifacts: current.artifacts }, current.identities,
    new Map(), new Map(), new Map(), current.components, {}, diagnostics);
}

test("corrupt sealed source artifact identities use the single internal route without creating a source rejection", () => {
  const mutations = [
    ["missing compiler path", current => { current.program.source.ast.getPath = () => undefined; }],
    ["duplicate original source", current => { current.program.sourceFiles.push(current.sourceFile); }],
    ["missing admitted identity", current => { current.identities.clear(); }],
    ["missing admitted component", current => { current.components = []; }],
    ["foreign graph owner", current => {
      current.program.sourceFiles = [];
      current.artifacts.contractGraph.markDirty("foreign-owner");
    }],
  ];
  for (const [label, mutate] of mutations) {
    const current = reconstructionFixture();
    mutate(current);
    const diagnostics = [];
    assert.throws(() => reconstructFixture(current, diagnostics), error =>
      error.phase === "planning" && error.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.diagnostic.source === "tsonic-rust", label);
    assert.equal(diagnostics.length, 0, `${label}: corrupt compiler state is not reported as unsupported source`);
  }
});

test("a legitimate reconstruction resource result retains its original code and reason", () => {
  const current = reconstructionFixture();
  const code = "TARGET_ARTIFACT_RECONSTRUCTION_BUDGET_EXCEEDED";
  const reason = "Target artifact reconstruction exceeds its finite 64-attempt budget.";
  current.artifacts = { contractGraph: { markDirty: () => ({ kind: "rejected", code, reason }) } };
  const diagnostics = [];
  assert.equal(reconstructFixture(current, diagnostics) === undefined, true, "the failed resource result publishes no source plan");
  assert.deepEqual(diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message]), [[code, reason]],
    "resource transport remains exact and is not converted to an internal error");
});

function contractFor(item) {
  return rustSourceFileContractCandidate(
    "source-file:/project/value.ts",
    createRustSourceFile([item]),
    [],
  ).contract;
}

function functionItem(primitive, value) {
  return {
    kind: "function",
    name: "value",
    visibility: "public",
    params: [],
    returnType: { kind: "primitive", name: primitive },
    body: {
      statements: [{
        kind: "tail",
        expr: { kind: "int-literal", text: value },
      }],
    },
  };
}

function facet(contract, name) {
  const entry = contract.facets.find((candidate) => candidate.facet === name);
  assert.notEqual(entry, undefined);
  return entry.value;
}
