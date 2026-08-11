import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRustSourceFile,
} from "../dist/backend/rust-ast/nodes.js";
import {
  rustSourceFileContractCandidate,
} from "../dist/backend/planner/source-file-artifact-contract.js";

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
