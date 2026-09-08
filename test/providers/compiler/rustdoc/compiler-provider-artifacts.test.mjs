import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rustCompilerProviderProtocolVersion } from "../../../../dist/providers/compiler/model/model.js";
import { parseRustdocDocument } from "../../../../dist/providers/compiler/model/rustdoc-schema.js";
import { createRustdocDocumentLoader } from "../../../../dist/providers/compiler/snapshot/rustdoc-artifact.js";
import {
  createRustCompilerCacheDirectory,
  isDeclaredCacheDirectory,
} from "../../../../dist/providers/compiler/snapshot/cache-directory.js";
import {
  createRustCompilerProjectSnapshot,
  verifyRustCompilerDependencySource,
} from "../../../../dist/providers/compiler/snapshot/cargo-snapshot.js";
import { createRustCompilerWorkerClient } from "../../../../dist/providers/compiler/protocol/worker-client.js";

const testRoot = fileURLToPath(new URL("../../../../.temp/compiler-provider-artifact-tests/", import.meta.url));
const cacheSignature = "Signature: 8a477f597d28d172789f06886806bc55";

test("one rustdoc decoder accepts the audited signature formats without changing their facts", () => {
  const artifact = createArtifact();
  for (const format of [57, 58, 59, 60]) {
    const document = { ...artifact.document, format_version: format };
    assert.deepEqual(parseRustdocDocument(JSON.stringify(document), artifact.request.dependency), document);
  }
  for (const format of [56, 61, 57.5, "60", null]) {
    assert.throws(() => parseRustdocDocument(JSON.stringify({
      ...artifact.document,
      format_version: format,
    }), artifact.request.dependency), /unsupported JSON contract/);
  }
  for (const mutation of [{ root: null }, { index: [] }, { paths: null }]) {
    assert.throws(() => parseRustdocDocument(JSON.stringify({
      ...artifact.document,
      ...mutation,
    }), artifact.request.dependency), /unsupported JSON contract/);
  }
  assert.throws(() => parseRustdocDocument(JSON.stringify({
    ...artifact.document,
    crate_version: "9.0.0",
  }), artifact.request.dependency), /does not match Cargo package version/);
});

test("one worker document loader reuses an unchanged parsed artifact across 250 requests", () => {
  const artifact = createArtifact();
  const load = createRustdocDocumentLoader();
  const first = load(artifact.request);
  for (let request = 0; request < 250; request += 1) {
    assert.equal(load(artifact.request), first);
  }
  assert.deepEqual(first, artifact.document);
  assert.throws(() => load({
    ...artifact.request,
    dependency: { ...artifact.request.dependency, packageVersion: "9.0.0" },
  }), /does not belong to snapshot/);
});

test("document reuse detects same-size edits with restored mtimes and replaced inodes", () => {
  const artifact = createArtifact();
  const load = createRustdocDocumentLoader();
  const first = load(artifact.request);
  const outputStat = statSync(artifact.path);
  const markerStat = statSync(artifact.markerPath);
  const changed = { ...artifact.document, root: 2 };
  writeArtifact(artifact, changed);
  assert.equal(statSync(artifact.path).size, outputStat.size);
  utimesSync(artifact.path, outputStat.atime, outputStat.mtime);
  utimesSync(artifact.markerPath, markerStat.atime, markerStat.mtime);
  const second = load(artifact.request);
  assert.notEqual(second, first);
  assert.deepEqual(second, changed);
  assert.equal(load(artifact.request), second);
  const replacement = `${artifact.path}.replacement`;
  writeFileSync(replacement, readFileSync(artifact.path));
  renameSync(replacement, artifact.path);
  assert.notEqual(load(artifact.request), second);
});

test("document retention has both byte and entry bounds with LRU eviction", () => {
  const artifacts = [createArtifact(), createArtifact(), createArtifact()];
  const load = createRustdocDocumentLoader({ maxEntries: 2 });
  const first = load(artifacts[0].request);
  const second = load(artifacts[1].request);
  assert.equal(load(artifacts[0].request), first);
  load(artifacts[2].request);
  assert.equal(load(artifacts[0].request), first);
  assert.notEqual(load(artifacts[1].request), second);
  const byteBound = createRustdocDocumentLoader({
    maxBytes: statSync(artifacts[0].path).size + statSync(artifacts[1].path).size - 1,
  });
  const beforeEviction = byteBound(artifacts[0].request);
  byteBound(artifacts[1].request);
  assert.notEqual(byteBound(artifacts[0].request), beforeEviction);
  const oversized = createRustdocDocumentLoader({ maxBytes: 1 });
  assert.notEqual(oversized(artifacts[0].request), oversized(artifacts[0].request));
  for (const options of [{ maxEntries: 0 }, { maxEntries: 1.5 }, { maxBytes: Infinity }]) {
    assert.throws(() => createRustdocDocumentLoader(options), /positive finite/);
  }
});

test("cache tags are explicit exact regular-file declarations, never directory-name guesses", () => {
  const root = uniquePath();
  const tagPath = join(root, "CACHEDIR.TAG");
  assert.equal(isDeclaredCacheDirectory(root), false);
  for (const text of ["", "cache", ` ${cacheSignature}`, `${cacheSignature.slice(0, -1)}0`]) {
    writeFileSync(tagPath, text);
    assert.equal(isDeclaredCacheDirectory(root), false);
  }
  assert.throws(() => createRustCompilerCacheDirectory(root), /invalid CACHEDIR.TAG/);
  writeFileSync(tagPath, `${cacheSignature}\n# Cargo build artifacts\n`);
  assert.equal(isDeclaredCacheDirectory(root), true);
  createRustCompilerCacheDirectory(root);
  assert.match(readFileSync(tagPath, "utf8"), /Cargo build artifacts/);
  const symlinkRoot = uniquePath();
  symlinkSync(tagPath, join(symlinkRoot, "CACHEDIR.TAG"));
  assert.equal(isDeclaredCacheDirectory(symlinkRoot), false);
  assert.throws(() => createRustCompilerCacheDirectory(symlinkRoot), /invalid CACHEDIR.TAG/);
});

test("Cargo snapshots exclude declared caches without hiding source or generated native inputs", { timeout: 120_000 }, () => {
  const project = createCargoProject();
  const cache = join(project.dependencyRoot, "products", "cache-output");
  createRustCompilerCacheDirectory(cache);
  const largeArtifact = join(cache, "native-object");
  writeFileSync(largeArtifact, "");
  truncateSync(largeArtifact, 1_073_741_825);
  writeFileSync(join(project.dependencyRoot, "CACHEDIR.TAG"), `${cacheSignature}\n`);
  const authored = ["src/lib.rs", ".tsonic/native.rs", "generated/native.rs", "invalid-tag/native.rs"];
  for (const path of authored.slice(1)) {
    const fullPath = join(project.dependencyRoot, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, "pub fn generated() {}\n");
  }
  writeFileSync(join(project.dependencyRoot, "invalid-tag/CACHEDIR.TAG"), "not a cache tag");
  const workerRoot = join(project.dependencyRoot, "requests-at-a-custom-location");
  const worker = createRustCompilerWorkerClient(workerRoot);
  assert.equal(isDeclaredCacheDirectory(workerRoot), true);
  const snapshot = worker.snapshot(project.manifestPath);
  const dependency = snapshot.dependencies.find(({ alias }) => alias === "native");
  assert.ok(dependency);
  assert.deepEqual(Object.keys(snapshot.compiler), ["rustcVerboseVersion"]);
  assert.match(snapshot.compiler.rustcVerboseVersion, /rustc /);
  assert.equal(worker.snapshot(project.manifestPath).digest, snapshot.digest);
  appendFileSync(largeArtifact, "cache mutation");
  verifyRustCompilerDependencySource(snapshot, dependency);
  for (const path of authored) {
    const fullPath = join(project.dependencyRoot, path);
    const original = readFileSync(fullPath);
    appendFileSync(fullPath, "\npub fn changed() {}\n");
    assert.throws(() => verifyRustCompilerDependencySource(snapshot, dependency), /changed after/);
    writeFileSync(fullPath, original);
    verifyRustCompilerDependencySource(snapshot, dependency);
  }
});

test("an unmarked oversized Cargo input still fails the unchanged finite budget", { timeout: 120_000 }, () => {
  const project = createCargoProject();
  const artifact = join(project.dependencyRoot, "not-declared-as-cache");
  writeFileSync(artifact, "");
  truncateSync(artifact, 1_073_741_825);
  assert.throws(() => createRustCompilerProjectSnapshot(project.manifestPath), /finite byte budget/);
});

test("standard-library imports work with an empty offline Cargo cache and bundled sources", { timeout: 300_000 }, () => {
  const original = { CARGO_HOME: process.env.CARGO_HOME, CARGO_NET_OFFLINE: process.env.CARGO_NET_OFFLINE };
  const cargoHome = uniquePath();
  process.env.CARGO_HOME = cargoHome;
  process.env.CARGO_NET_OFFLINE = "true";
  try {
    const worker = createRustCompilerWorkerClient(uniquePath());
    const snapshot = worker.standardSnapshot();
    const dependency = snapshot.dependencies.find(({ alias }) => alias === "core");
    assert.ok(dependency);
    const module = worker.module({
      snapshot,
      dependency,
      foundation: "core",
      modulePath: ["cmp"],
      requestedExports: ["Ordering"],
    });
    assert.deepEqual(module.exports.map(({ name }) => name), ["Ordering"]);
    for (const directory of ["index", "cache", "src"]) {
      assert.equal(existsSync(join(cargoHome, "registry", directory)), false);
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function createArtifact() {
  const root = uniquePath();
  const dependency = {
    alias: "native",
    packageId: "native@1.0.0",
    packageName: "native",
    packageVersion: "1.0.0",
    crateName: "native",
    targetCrateName: "native",
    manifestPath: join(root, "Cargo.toml"),
    sourceRoot: root,
    sourceDigest: "native-source",
    closurePackageIds: ["native@1.0.0"],
    features: [],
  };
  const snapshot = {
    kind: "cargo-project",
    protocolVersion: rustCompilerProviderProtocolVersion,
    manifestPath: join(root, "Cargo.toml"),
    rootPackageId: "consumer@1.0.0",
    compiler: { rustcVerboseVersion: "artifact-proof-compiler" },
    dependencies: [dependency],
    packageSources: [],
    digest: root,
  };
  const document = { root: 1, crate_version: "1.0.0", index: {}, paths: {}, format_version: 60 };
  const path = join(root, "doc/native.json");
  mkdirSync(dirname(path), { recursive: true });
  const artifact = {
    request: { snapshot, dependency, targetDirectory: root },
    document,
    path,
    markerPath: `${path}.tsonic-provider.json`,
  };
  writeArtifact(artifact, document);
  return artifact;
}

function writeArtifact(artifact, document) {
  const text = JSON.stringify(document);
  writeFileSync(artifact.path, text);
  writeFileSync(artifact.markerPath, JSON.stringify({
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: artifact.request.snapshot.digest,
    dependencyAlias: artifact.request.dependency.alias,
    dependencySourceDigest: artifact.request.dependency.sourceDigest,
    compilerIdentity: artifact.request.snapshot.compiler.rustcVerboseVersion,
    outputDigest: createHash("sha256").update(text).digest("hex"),
  }));
}

function createCargoProject() {
  const root = uniquePath();
  const dependencyRoot = join(root, "native");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(dependencyRoot, "src"), { recursive: true });
  writeFileSync(join(root, "src/lib.rs"), "");
  writeFileSync(join(dependencyRoot, "src/lib.rs"), "pub fn value() -> i32 { 42 }\n");
  writeFileSync(join(dependencyRoot, "Cargo.toml"), '[package]\nname = "native"\nversion = "1.0.0"\nedition = "2021"\n');
  const manifestPath = join(root, "Cargo.toml");
  writeFileSync(manifestPath, '[package]\nname = "consumer"\nversion = "1.0.0"\nedition = "2021"\n[dependencies]\nnative = { path = "native" }\n');
  return { manifestPath, dependencyRoot };
}

function uniquePath() {
  const root = join(testRoot, `${process.pid}-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}
