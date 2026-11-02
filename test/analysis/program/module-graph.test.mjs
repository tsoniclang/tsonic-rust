import assert from "node:assert/strict";
import test from "node:test";
import { TargetCompilerResourceLimitFailure } from "@tsonic/target-api/artifacts";
import { stronglyConnectedSourceFiles, cyclicSourceFiles } from "../../../dist/analysis/program/module-graph.js";

test("source module graphs preserve exact dependency identities and reject exhausted component accounting", () => {
  const left = { name: "same" };
  const right = { name: "same" };
  const isolated = {};
  const navigation = { moduleDependencies(file) {
    return file === left ? [{ sourceFile: right }] : file === right ? [{ sourceFile: left }] : [];
  } };
  const files = [left, right, isolated];
  const components = stronglyConnectedSourceFiles(navigation, new Set(files));
  assert.equal(components.kind, "resolved");
  assert.equal(components.components.length, 2);
  const cyclic = cyclicSourceFiles(navigation, files);
  assert.equal(cyclic.kind, "resolved");
  assert.equal(cyclic.sourceFiles.size, 2);
  assert.equal(cyclic.sourceFiles.has(left), true);
  assert.equal(cyclic.sourceFiles.has(right), true);
  assert.equal(cyclic.sourceFiles.has(isolated), false);
  for (const query of [() => stronglyConnectedSourceFiles(navigation, new Set(files), 1),
    () => cyclicSourceFiles(navigation, files, 1)]) {
    assert.throws(query, failure => failure instanceof TargetCompilerResourceLimitFailure &&
      failure.diagnostic.code === "TSONIC_COMPILER_RESOURCE_LIMIT" && failure.diagnostic.evidence?.[0] === "steps=1" &&
      !("components" in failure) && !("sourceFiles" in failure),
    "finite exhaustion is a named compiler resource failure with no partial component or cycle publication");
  }
});
