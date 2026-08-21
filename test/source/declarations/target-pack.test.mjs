import { test } from "node:test";
import assert from "node:assert/strict";
import { createTargetRegistry } from "@tsonic/target-api";
import { createRustTargetPack, rustTargetId } from "../../../dist/index.js";

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
  const { createTsonicPlugin } = await import("../../../dist/index.js");
  const plugin = createTsonicPlugin();
  assert.equal(plugin.kind, "target");
  assert.equal(plugin.id, "@tsonic/target-rust");
  assert.equal(plugin.targetId, "rust");
  assert.equal(plugin.createTargetPack().id, "rust");
});

test("rust provider contributes source semantics and validates options", () => {
  const pack = createRustTargetPack();
  const target = { id: "rust", options: {} };
  const session = pack.createCompilationSession(sessionContext(target));
  session.sourceProfileContributions();
  const contribution = session.sourceCompilerContributions();
  assert.equal(contribution.extensions.length, 1);
  assert.equal(contribution.extensions[0].identity.id, "tsonic.rust.source-semantics");
  session.close();
  assert.throws(
    () => pack.createCompilationSession(sessionContext({
      id: "rust",
      options: { unknown: true },
    })),
    /Rust target option 'options\.unknown' is not supported\./,
  );
});

test("the compilation session owns target option validation", () => {
  const pack = createRustTargetPack();
  const target = { id: "rust", options: { unknown: true } };
  assert.throws(
    () => pack.createCompilationSession(sessionContext(target)),
    /not supported/u,
  );
});

test("the compilation session enforces one ordered lifecycle and idempotent close", () => {
  const pack = createRustTargetPack();
  const target = { id: "rust", options: {} };
  const first = pack.createCompilationSession(sessionContext(target));

  assert.throws(
    () => first.sourceCompilerContributions(),
    /expected 'profile-contributed'/u,
  );
  first.close();
  first.close();
  assert.throws(
    () => first.sourceProfileContributions(),
    /while in 'closed'/u,
  );

  const second = pack.createCompilationSession(sessionContext(target));
  second.sourceProfileContributions();
  assert.throws(
    () => second.sourceProfileContributions(),
    /expected 'created'/u,
  );
  assert.throws(
    () => second.runtimeContributions(),
    /expected 'compiler-contributed'/u,
  );
  second.sourceCompilerContributions();
  assert.throws(
    () => second.sourceCompilerContributions(),
    /expected 'profile-contributed'/u,
  );
  assert.throws(
    () => second.compile(undefined),
    /expected 'runtime-contributed'/u,
  );
  second.close();
});

test("the compilation session rejects foreign capability payloads before provider setup", () => {
  const pack = createRustTargetPack();
  const context = sessionContext({ id: "rust", options: {} });

  assert.throws(
    () => pack.createCompilationSession({
      ...context,
      capabilities: [{
        capabilityId: "foreign.capability",
        moduleOwnership: [],
        contributions: [{ kind: "foreign-policy" }],
      }],
    }),
    /unsupported target contribution kind 'foreign-policy'/u,
  );
});

test("package manifest declares the installed plugin contract", async () => {
  const { readFileSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.tsonic, { kind: "plugin", contractVersion: 1, entry: "." });
  assert.equal(manifest.exports["./package.json"], "./package.json");
  assert.equal(manifest.exports["."], "./dist/index.js");
  assert.equal(manifest.exports["./provider"], "./dist/public/provider.js");
  // package.json resolves through package exports from a consumer.
  const require = createRequire(new URL("../../../node_modules/x/index.js", import.meta.url));
  void require;
  const { createTsonicPlugin } = await import("../../../dist/index.js");
  assert.equal(createTsonicPlugin().id, "@tsonic/target-rust");
});

test("target runtime crate references resolve inside the package", async () => {
  const { existsSync } = await import("node:fs");
  const pack = createRustTargetPack();
  const target = { id: "rust", options: {} };
  const session = pack.createCompilationSession(sessionContext(target));
  session.sourceProfileContributions();
  session.sourceCompilerContributions();
  const references = session.runtimeContributions().references;
  session.close();
  for (const reference of references) {
    assert.match(reference.include, /rust-runtime\/crates\/tsonic_rust_runtime$/u);
    assert.ok(existsSync(reference.include), `missing packaged crate: ${reference.include}`);
  }
});

function sessionContext(target) {
  return {
    project: { entryPoint: "src/index.ts", targets: [target] },
    projectDirectory: process.cwd(),
    target,
    paths: {
      projectFilePath: `${process.cwd()}/tsonic.json`,
      projectRoot: process.cwd(),
      outputRoot: `${process.cwd()}/out`,
      targetOutputRoot: `${process.cwd()}/out/rust`,
    },
    selectedSurfaceIds: [],
    capabilities: [],
  };
}
