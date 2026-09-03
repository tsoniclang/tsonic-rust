import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Rust target entrypoints expose one API per audience", async () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(manifest.exports).sort(), [
    ".",
    "./package.json",
    "./provider",
  ]);

  const root = await import("../../../dist/index.js");
  assert.deepEqual(Object.keys(root).sort(), [
    "createRustStarterProject",
    "createRustTargetPack",
    "createTsonicPlugin",
    "rustTargetId",
  ]);
  assert.equal("createRustBackend" in root, false);
  assert.equal("createRustProviderPackage" in root, false);
  assert.equal("printRustSourceFile" in root, false);

  const provider = await import("../../../dist/public/provider.js");
  assert.equal(typeof provider.createRustProviderPackage, "function");
  assert.equal(typeof provider.rustCallableTargetType, "function");
  assert.equal(typeof provider.rustSourcePrimitiveTargetType, "function");
  assert.equal("createRustTargetPack" in provider, false);
  assert.equal("printRustSourceFile" in provider, false);
});
