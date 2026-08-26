import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import {
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../../../dist/providers/packages/index.js";

const cratePath = resolve("test/fixtures/crates/acme_files");

function definition(overrides = {}) {
  return {
    id: "acme-lifecycle",
    displayName: "Acme lifecycle",
    version: "1.0.0",
    compilationSnapshotId: "acme-lifecycle@1.0.0",
    modules: [{
      moduleSpecifier: "@acme/lifecycle",
      providerModuleId: "acme.lifecycle",
      exports: [],
    }],
    operations: [],
    crates: [{ crateName: "acme_lifecycle", cargoPath: cratePath }],
    binaryEpilogues: [{
      id: "drain",
      path: "runtime::drain",
      requiredCrate: "acme_lifecycle",
    }],
    aliasImports: [{ alias: "runtime", path: "acme_lifecycle::event_loop" }],
    ...overrides,
  };
}

test("binary epilogues materialize aliases into one deterministic provider-owned row", () => {
  const semantics = collectRustProviderSemanticsFromDefinitions([definition()]);
  assert.deepEqual(semantics.binaryEpilogues, [{
    id: "drain",
    path: "acme_lifecycle::event_loop::drain",
    requiredCrate: "acme_lifecycle",
    providerPackageId: "acme-lifecycle",
    providerVersion: "1.0.0",
  }]);
});

test("identical binary epilogues merge idempotently and contradictory rows fail closed", () => {
  const duplicate = mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([definition()]),
    collectRustProviderSemanticsFromDefinitions([definition()]),
  );
  assert.equal(duplicate.binaryEpilogues.length, 1);

  assert.throws(
    () => mergeRustProviderSemantics(
      collectRustProviderSemanticsFromDefinitions([definition()]),
      collectRustProviderSemanticsFromDefinitions([definition({
        binaryEpilogues: [{
          id: "drain",
          path: "runtime::different",
          requiredCrate: "acme_lifecycle",
        }],
      })]),
    ),
    /binary epilogue .* has conflicting definitions/u,
  );
});

test("binary epilogues require exact paths, declared crates, unique ids, and true-only fallibility", () => {
  const invalid = [
    {
      epilogues: [{ id: "drain", path: "runtime::drain", requiredCrate: "missing" }],
      pattern: /requires undeclared crate 'missing'/u,
    },
    {
      epilogues: [{ id: "drain", path: "runtime::drain\(\)", requiredCrate: "acme_lifecycle" }],
      pattern: /not a closed Rust path/u,
    },
    {
      epilogues: [
        { id: "drain", path: "runtime::drain", requiredCrate: "acme_lifecycle" },
        { id: "drain", path: "runtime::again", requiredCrate: "acme_lifecycle" },
      ],
      pattern: /duplicate binary epilogue id 'drain'/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        requiredCrate: "acme_lifecycle",
        isFallible: false,
      }],
      pattern: /invalid isFallible value/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        requiredCrate: "acme_lifecycle",
        isFallible: true,
      }],
      pattern: /requires an exact errorBoundary/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        requiredCrate: "acme_lifecycle",
        errorBoundary: "source-program",
      }],
      pattern: /cannot declare an errorBoundary/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        requiredCrate: "acme_lifecycle",
        isFallible: true,
        errorBoundary: "guess",
      }],
      pattern: /requires an exact errorBoundary/u,
    },
  ];

  for (const { epilogues, pattern } of invalid) {
    assert.throws(
      () => createRustProviderPackage(definition({ binaryEpilogues: epilogues })),
      pattern,
    );
  }
});
