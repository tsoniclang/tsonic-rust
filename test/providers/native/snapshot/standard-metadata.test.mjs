import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { snapshotStandardMetadataArtifacts } from "../../../../dist/providers/native/snapshot/standard-metadata.js";

function workspace() {
  return createTestWorkspace(resolve(".temp/generated"), "standard-metadata-budget-");
}

test("native metadata snapshots retain more than 256 exact artifacts in deterministic order", () => {
  const root = workspace();
  const content = "native metadata\n";
  for (let index = 257; index >= 0; index -= 1) {
    writeFileSync(join(root, `libfixture${index}-aa.rmeta`), content);
  }
  writeFileSync(join(root, "not-metadata.txt"), "not a selected native artifact");
  const artifacts = snapshotStandardMetadataArtifacts(root);
  assert.equal(artifacts.length, 258);
  assert.deepEqual(artifacts.map(artifact => artifact.crateName),
    Array.from({ length: 258 }, (_value, index) => `fixture${index}`).sort());
  assert.equal(Object.isFrozen(artifacts), true);
  const digest = createHash("sha256").update(content).digest("hex");
  for (const artifact of artifacts) {
    assert.equal(artifact.digest, digest);
    assert.equal(artifact.byteLength, Buffer.byteLength(content));
    assert.equal(artifact.modifiedMilliseconds, statSync(artifact.path).mtimeMs);
    assert.equal(Object.isFrozen(artifact), true);
  }
});

test("native metadata snapshots hash complete artifacts across fixed-buffer boundaries", () => {
  const root = workspace();
  const content = Buffer.alloc(65_536 * 3 + 19);
  for (let index = 0; index < content.length; index += 1) content[index] = index % 251;
  writeFileSync(join(root, "libfixture-ab.rmeta"), content);
  const [artifact] = snapshotStandardMetadataArtifacts(root);
  assert.equal(artifact.byteLength, content.length);
  assert.equal(artifact.digest, createHash("sha256").update(content).digest("hex"));
});

test("native metadata snapshots reject empty inventories", () => {
  const root = workspace();
  assert.throws(() => snapshotStandardMetadataArtifacts(root), /expected 1-1024/u);
});

test("native metadata snapshots preserve distinct native artifacts sharing a crate name", () => {
  const root = workspace();
  writeFileSync(join(root, "libfixture-aa.rmeta"), "first");
  writeFileSync(join(root, "libfixture-bb.rmeta"), "second");
  const artifacts = snapshotStandardMetadataArtifacts(root);
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts[0].crateName, artifacts[1].crateName);
  assert.notEqual(artifacts[0].path, artifacts[1].path);
  assert.equal(artifacts[0].digest, createHash("sha256").update("first").digest("hex"));
  assert.equal(artifacts[1].digest, createHash("sha256").update("second").digest("hex"));
});

test("native metadata snapshots preserve a finite artifact-count limit", () => {
  const root = workspace();
  for (let index = 0; index < 1025; index += 1) writeFileSync(join(root, `libfixture${index}-aa.rmeta`), "");
  assert.throws(() => snapshotStandardMetadataArtifacts(root), /1025 metadata artifacts; expected 1-1024/u);
});

test("native metadata snapshots reject excessive aggregate bytes before reading artifacts", () => {
  const root = workspace();
  for (let index = 0; index < 2; index += 1) {
    const path = join(root, `libfixture${index}-aa.rmeta`);
    writeFileSync(path, "");
    truncateSync(path, 536_870_913);
  }
  assert.throws(() => snapshotStandardMetadataArtifacts(root), /1073741824-byte budget/u);
});

test("native metadata snapshots ignore directories rather than reading them as artifacts", () => {
  const root = workspace();
  mkdirSync(join(root, "libdirectory-aa.rmeta"));
  writeFileSync(join(root, "libfixture-aa.rmeta"), "");
  const artifacts = snapshotStandardMetadataArtifacts(root);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].crateName, "fixture");
  assert.equal(artifacts[0].digest, createHash("sha256").digest("hex"));
});
