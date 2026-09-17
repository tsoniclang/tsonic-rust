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
    modules: [{
      moduleSpecifier: "@acme/lifecycle",
      providerModuleId: "acme.lifecycle",
      exports: [],
    }],
    operations: [],
    crates: [{ crateName: "acme_lifecycle", cargoPath: cratePath }],
    binaryHooks: [{
      id: "drain",
      path: "runtime::drain",
      phase: "after-entry", requiredCrate: "acme_lifecycle",
    }],
    aliasImports: [{ alias: "runtime", path: "acme_lifecycle::event_loop" }],
    ...overrides,
  };
}

test("binary hooks materialize aliases into one deterministic provider-owned row", () => {
  const semantics = collectRustProviderSemanticsFromDefinitions([definition()]);
  assert.deepEqual(semantics.binaryHooks, [{
    id: "drain",
    path: "acme_lifecycle::event_loop::drain",
    phase: "after-entry", requiredCrate: "acme_lifecycle",
    providerPackageId: "acme-lifecycle",
    providerVersion: "1.0.0",
  }]);
});

test("identical binary hooks merge idempotently and contradictory rows fail closed", () => {
  const duplicate = mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([definition()]),
    collectRustProviderSemanticsFromDefinitions([definition()]),
  );
  assert.equal(duplicate.binaryHooks.length, 1);

  assert.throws(
    () => mergeRustProviderSemantics(
      collectRustProviderSemanticsFromDefinitions([definition()]),
      collectRustProviderSemanticsFromDefinitions([definition({
        binaryHooks: [{
          id: "drain",
          path: "runtime::different",
          phase: "after-entry", requiredCrate: "acme_lifecycle",
        }],
      })]),
    ),
    /binary hook .* has conflicting definitions/u,
  );
});

test("binary hooks require exact paths, declared crates, unique ids, and true-only fallibility", () => {
  const invalid = [
    {
      epilogues: [{ id: "drain", path: "runtime::drain", phase: "after-entry", requiredCrate: "missing" }],
      pattern: /requires undeclared crate 'missing'/u,
    },
    {
      epilogues: [{ id: "drain", path: "runtime::drain\(\)", phase: "after-entry", requiredCrate: "acme_lifecycle" }],
      pattern: /not a closed Rust path/u,
    },
    {
      epilogues: [
        { id: "drain", path: "runtime::drain", phase: "after-entry", requiredCrate: "acme_lifecycle" },
        { id: "drain", path: "runtime::again", phase: "after-entry", requiredCrate: "acme_lifecycle" },
      ],
      pattern: /duplicate binary hook id 'drain'/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        phase: "after-entry", requiredCrate: "acme_lifecycle",
        isFallible: false,
      }],
      pattern: /invalid isFallible value/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        phase: "after-entry", requiredCrate: "acme_lifecycle",
        isFallible: true,
      }],
      pattern: /requires an exact errorBoundary/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        phase: "after-entry", requiredCrate: "acme_lifecycle",
        errorBoundary: "source-program",
      }],
      pattern: /cannot declare an errorBoundary/u,
    },
    {
      epilogues: [{
        id: "drain",
        path: "runtime::drain",
        phase: "after-entry", requiredCrate: "acme_lifecycle",
        isFallible: true,
        errorBoundary: "guess",
      }],
      pattern: /requires an exact errorBoundary/u,
    },
  ];

  for (const { epilogues, pattern } of invalid) {
    assert.throws(
      () => createRustProviderPackage(definition({ binaryHooks: epilogues })),
      pattern,
    );
  }
});

test("binary hook phases are explicit, immutable and conflict checked", () => {
  for (const phase of [undefined, null, "startup", 0]) {
    assert.throws(() => createRustProviderPackage(definition({ binaryHooks: [{
      ...definition().binaryHooks[0], phase,
    }] })), /exact lifecycle phase/u);
  }
  const startup = definition({ binaryHooks: [{
    ...definition().binaryHooks[0], phase: "before-initialization",
  }] });
  const selected = collectRustProviderSemanticsFromDefinitions([startup]);
  assert.equal(selected.binaryHooks[0].phase, "before-initialization");
  assert.equal(Object.isFrozen(selected.binaryHooks[0]), true);
  assert.throws(() => mergeRustProviderSemantics(selected,
    collectRustProviderSemanticsFromDefinitions([definition()])), /conflicting definitions/u);
  assert.throws(() => createRustProviderPackage(definition({ binaryEpilogues: [] })), /binaryEpilogues/u);
});
