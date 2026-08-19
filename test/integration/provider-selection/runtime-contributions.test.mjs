import { test } from "node:test";
import assert from "node:assert/strict";
import { createRustTargetPack } from "../../../dist/index.js";
import { cargoPathReferenceKind } from "../../../dist/providers/model/cargo-reference.js";
import { fakeRuntimeContributionContext } from "../../helpers/fake-compile-input.mjs";

function references(contextOptions) {
  const pack = createRustTargetPack();
  return pack.provider.runtimeContributions(fakeRuntimeContributionContext(contextOptions)).references;
}

test("the target provider contributes only the shared Rust runtime crate", () => {
  const refs = references({ target: { id: "rust", options: {} } });

  assert.equal(refs.length, 1);
  const [runtime] = refs;
  assert.equal(runtime.kind, cargoPathReferenceKind);
  assert.equal(runtime.attributes.crate, "tsonic_rust_runtime");
  assert.equal(runtime.attributes.registryPatch, "crates-io");
  assert.match(runtime.include, /rust-runtime\/crates\/tsonic_rust_runtime$/u);
});

test("the JS surface contributes exactly the rust-js crate", () => {
  const pack = createRustTargetPack();
  const surface = pack.surfaces.find((candidate) => candidate.id === "js");
  assert.ok(surface);
  const refs = surface.runtimeContributions(
    fakeRuntimeContributionContext({ target: { id: "rust", options: {} } }),
  ).references;

  assert.deepEqual(refs.map((reference) => reference.attributes.crate), ["tsonic_rust_js"]);
  assert.match(refs[0].include, /rust-js\/crates\/tsonic_rust_js$/u);
  assert.equal(refs[0].attributes.registryPatch, "crates-io");
});

test("runtime crate references resolve to installed package paths", () => {
  const refs = references({ target: { id: "rust", options: {} } });

  for (const reference of refs) {
    assert.ok(reference.include.startsWith("/"), `expected absolute path, got ${reference.include}`);
  }
});
