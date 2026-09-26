import assert from "node:assert/strict";
import test from "node:test";
import { createRustCompilerProviderSession } from "../../../../dist/providers/native/session.js";
import { rustCompilerProviderProtocolVersion } from "../../../../dist/providers/native/model/model.js";

test("closing a compiler-provider session revokes its per-build snapshot lease", () => {
  const snapshot = Object.freeze({
    kind: "standard-library",
    digest: "fixture-standard-library",
    dependencies: Object.freeze([]),
  });
  const worker = Object.freeze({
    standardSnapshot() {
      return snapshot;
    },
  });
  const session = createRustCompilerProviderSession({
    configuration: {
      crateName: "fixture",
      edition: "2021",
      outputType: "lib",
      project: { kind: "generated" },
    },
    cacheRoot: `${process.cwd()}/.temp/compiler-provider-session-cache`,
  }, worker);
  const [provider] = session.sourceProviders;

  assert.ok(provider);
  session.close();
  session.close();
  assert.throws(
    () => provider.ownsModule("@tsonic/rust/std/vec.js"),
    /snapshot lease is closed/u,
  );
  assert.throws(
    () => session.semantics(),
    /session is closed/u,
  );
});

test("compiler macro lookups require the complete bound identity and preserve a detached snapshot", () => {
  const dependency = { alias: "std", packageId: "compiler-std", packageName: "std", packageVersion: "1.0.0",
    crateName: "std", targetCrateName: "std", manifestPath: "/fixture/Cargo.toml", sourceRoot: "/fixture",
    sourceDigest: "fixture", closurePackageIds: ["compiler-std"], features: [] };
  const native = { id: "compiler-std#73", name: "arbitrary_generated", kind: "macro", macroKind: "derive",
    targetPath: ["std", "arbitrary_generated"], helpers: ["owned_helper"] };
  const snapshot = { kind: "standard-library", digest: "fixture-native-identities", dependencies: [dependency] };
  const session = createRustCompilerProviderSession({
    configuration: { crateName: "fixture", edition: "2021", outputType: "lib", foundation: "std", project: { kind: "generated" } },
    cacheRoot: `${process.cwd()}/.temp/compiler-provider-session-cache`,
  }, {
    standardSnapshot: () => snapshot,
    module: () => ({ protocolVersion: rustCompilerProviderProtocolVersion, projectDigest: snapshot.digest,
      dependency, modulePath: [], exports: [native], unsupportedExports: [], standardTypeLocations: [] }),
  });
  const provider = session.sourceProviders[0];
  const resolution = provider.resolveModule("@tsonic/rust/std/index.js", {});
  assert.equal(resolution.kind, "virtual");
  const declaration = provider.getDeclarationModel(resolution, { context: {}, materialization: { kind: "complete" } });
  assert.equal(declaration.exports[0].kind, "intrinsic");
  const identity = { providerId: provider.identity.id, providerVersion: provider.identity.version,
    providerModuleId: declaration.providerModuleId, moduleSpecifier: declaration.moduleSpecifier,
    artifactFileName: resolution.virtualFileName, exportName: native.name, exportId: declaration.exports[0].id };
  const selected = session.intrinsic(identity);
  assert.ok(selected);
  assert.equal(selected.native.id, "compiler-std#73");
  assert.deepEqual(selected.native.helpers, ["owned_helper"]);
  native.helpers[0] = "changed";
  native.targetPath[0] = "changed";
  assert.deepEqual(selected.native.helpers, ["owned_helper"]);
  assert.deepEqual(selected.native.targetPath, ["std", "arbitrary_generated"]);
  for (const mutation of [
    { providerId: "other" }, { providerVersion: "other" }, { providerModuleId: "other" },
    { moduleSpecifier: "other" }, { exportId: "other" }, { exportName: "other" },
    { memberId: "member" }, { signatureId: "call" },
  ]) assert.equal(session.intrinsic({ ...identity, ...mutation }), undefined, JSON.stringify(mutation));
  assert.deepEqual(session.semantics().operations, []);
  assert.equal(session.intrinsic(identity), selected);
  session.close();
  assert.throws(() => session.intrinsic(identity), /session is closed/u);
});
