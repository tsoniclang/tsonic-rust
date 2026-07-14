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

test("package manifest declares the installed plugin contract", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.tsonic, { kind: "plugin", contractVersion: 1, entry: "." });
  assert.equal(manifest.exports["./package.json"], "./package.json");
  assert.equal(manifest.exports["."], "./dist/index.js");
  // package.json resolves through package exports from a consumer.
  const require = createRequire(new URL("../node_modules/x/index.js", import.meta.url));
  void require;
  const { createTsonicPlugin } = await import("../dist/index.js");
  assert.equal(createTsonicPlugin().id, "@tsonic/target-rust");
});

test("target runtime crate references resolve inside the package", async () => {
  const { existsSync } = await import("node:fs");
  const pack = createRustTargetPack();
  const references = pack.provider.runtimeContributions({
    selectedSurfaces: [],
    target: { id: "rust", options: {} },
    paths: { projectRoot: process.cwd() },
  }).references;
  for (const reference of references) {
    assert.match(reference.include, /rust-runtime\/crates\/tsonic_rust_runtime$/u);
    assert.ok(existsSync(reference.include), `missing packaged crate: ${reference.include}`);
  }
});
