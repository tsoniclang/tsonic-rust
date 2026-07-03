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

test("rust target pack declares only the js surface; capabilities install separately", async () => {
  const pack = createRustTargetPack();

  assert.deepEqual(pack.surfaces.map((surface) => surface.id), ["js"]);
  assert.equal(pack.packages, undefined);
});

test("createTsonicPlugin exposes the installed target plugin contract", async () => {
  const { createTsonicPlugin } = await import("../dist/index.js");
  const plugin = createTsonicPlugin();
  assert.equal(plugin.kind, "target");
  assert.equal(plugin.id, "@tsonic/target-rust");
  assert.equal(plugin.targetId, "rust");
  assert.equal(plugin.createTargetPack().id, "rust");
});

test("rust provider creates the target semantics extension and validates options", () => {
  const pack = createRustTargetPack();
  const context = {
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "rust", options: {} },
    targetPack: pack,
    selectedCapabilities: [],
    selectedSurfaces: [],
  };

  const extensions = pack.provider.createExtensions(context);
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0].identity.id, "tsonic.rust.target-semantics");
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
