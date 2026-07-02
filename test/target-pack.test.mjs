import { test } from "node:test";
import assert from "node:assert/strict";
import { createTargetRegistry } from "@tsonic/target-api";
import { createRustTargetPack, rustTargetId } from "../dist/index.js";

test("rust target pack registers under the rust target id", () => {
  const registry = createTargetRegistry([createRustTargetPack()]);
  const pack = registry.get("rust");

  assert.ok(pack);
  assert.equal(pack.id, rustTargetId);
  assert.equal(pack.displayName, "Rust");
});

test("rust target pack exposes no surfaces or provider packages in slice R1", () => {
  const pack = createRustTargetPack();

  assert.equal(pack.surfaces, undefined);
  assert.equal(pack.packages, undefined);
});

test("rust provider creates no compiler extensions yet and validates options", () => {
  const pack = createRustTargetPack();
  const context = {
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "rust", options: {} },
    targetPack: pack,
    selectedPackages: [],
    selectedSurfaces: [],
  };

  assert.deepEqual(pack.provider.createExtensions(context), []);
  assert.throws(
    () => pack.provider.createExtensions({ ...context, target: { id: "rust", options: { unknown: true } } }),
    /Rust target option 'options\.unknown' is not supported\./,
  );
});

test("createBackend and createToolchain validate target options", () => {
  const pack = createRustTargetPack();
  const badContext = {
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "rust", options: { unknown: true } },
  };

  assert.throws(() => pack.createBackend(badContext), /not supported/);
  assert.throws(() => pack.createToolchain(badContext), /not supported/);
});
