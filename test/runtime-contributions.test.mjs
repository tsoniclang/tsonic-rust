import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustTargetPack, cargoPathReferenceKind } from "../dist/index.js";
import { fakeRuntimeContributionContext } from "./helpers/fake-compile-input.mjs";

function references(contextOptions) {
  const pack = createRustTargetPack();
  return pack.provider.runtimeContributions(fakeRuntimeContributionContext(contextOptions)).references;
}

test("strict-native mode contributes only the shared rust runtime crate", () => {
  const refs = references({ target: { id: "rust", options: {} } });

  assert.equal(refs.length, 1);
  const [runtime] = refs;
  assert.equal(runtime.kind, cargoPathReferenceKind);
  assert.equal(runtime.attributes.crate, "tsonic_rust_runtime");
  assert.equal(runtime.attributes.registryPatch, "crates-io");
  assert.match(runtime.include, /rust-runtime\/crates\/tsonic_rust_runtime$/u);
});

test("compat mode without js surface adds the rust-js crate", () => {
  const refs = references({ target: { id: "rust", options: { typescriptCompatibility: "compat" } } });

  assert.deepEqual(
    refs.map((reference) => reference.attributes.crate),
    ["tsonic_rust_runtime", "tsonic_rust_js"],
  );
  const jsReference = refs[1];
  assert.match(jsReference.include, /rust-js\/crates\/tsonic_rust_js$/u);
  assert.equal(jsReference.attributes.registryPatch, "crates-io");
});

test("compat mode with a selected js surface does not duplicate the rust-js crate", () => {
  const refs = references({
    target: { id: "rust", options: { typescriptCompatibility: "compat" } },
    selectedSurfaces: [{ id: "js" }],
  });

  assert.deepEqual(refs.map((reference) => reference.attributes.crate), ["tsonic_rust_runtime"]);
});

test("runtime crate references resolve to installed package paths", () => {
  const refs = references({ target: { id: "rust", options: {} } });

  for (const reference of refs) {
    assert.ok(reference.include.startsWith("/"), `expected absolute path, got ${reference.include}`);
  }
});
