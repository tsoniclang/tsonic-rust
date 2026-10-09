import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { collectTargetSourceProfileContributions } from "../../../../tsonic/packages/host/dist/target/source-profile.js";
import { errorConstructorFootprintSource, errorOriginDomainSource, errorRecoveryDomainSource } from "../../../../tsonic/test/fixtures/error-origin-domains.mjs";
import { createRustErrorStorageDemandQuery } from "../../../dist/analysis/objects/error-storage-demands.js";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/facts/source-profile-registry.js";
import { createRustSourceProfileStorageEffects } from "../../../dist/policy/operations/source-profiles/source-storage-effects.js";
import { rustNativeSourceProfileContributions, rustJsSurfaceSourceProfileContributions } from "../../../dist/source/profiles/declarations.js";
import { compileRust } from "../../helpers/rust-session.mjs";

for (const jsEnabled of [false, true]) {
  const profileName = jsEnabled ? "JS" : "native";
  for (const called of [false, true]) {
  test(`Rust ${profileName} ${called ? "call" : "new"} Error proof distinguishes open public formals from private native inputs`, () => {
    const profile = collectTargetSourceProfileContributions({ project: {}, projectRoot: "/src", projectDirectory: "/src",
      target: { id: "rust", options: {} }, targetPackId: jsEnabled ? "js" : "rust", selectedCapabilities: [], selectedSurfaces: [],
      targetContributions: jsEnabled ? rustJsSurfaceSourceProfileContributions() : rustNativeSourceProfileContributions() });
    assert.equal(profile.diagnostics.length === 0, true);
    const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: new Map([
      ["/src/index.ts", errorOriginDomainSource(called)], ...profile.files.map(file => [file.path, file.text]),
    ]), compilerOptions: { strict: true, noLib: true, skipLibCheck: true, module: "esnext", moduleResolution: "bundler" } }).checkSource();
    assert.equal(checked.diagnostics.length === 0, true);
    const source = createTargetSourceProgram(checked);
    const file = source.sourceFiles.find(file => source.ast.getFileName(file) === "/src/index.ts");
    const profiles = createRustSourceProfileRegistry(source.sourceFiles, source.ast, jsEnabled);
    const demand = createRustErrorStorageDemandQuery(source, profiles, createSourceStorageQuery(source, [file], defaultSourceStorageLimits,
      createRustSourceProfileStorageEffects(source, profiles)), () => ({ kind: "ordinary" }));
    for (const [name, expectedDomain] of [["inspect", "open"], ["privateInspect", "complete"]]) {
      const declaration = source.ast.statements(file).find(node => source.ast.is.IsFunctionDeclaration(node) &&
        source.ast.text(source.ast.name(node)) === name);
      const formal = source.ast.parameters(declaration)[0];
      const observed = demand.storageOriginsFor(formal);
      assert.equal(observed.kind === "resolved" && observed.origins.length > 0 &&
        observed.origins.every(origin => demand.isNativeConstructor(origin.node)), true, `${name}: same observed native roots`);
      assert.equal(demand.closedStorageOriginsFor(formal).kind === expectedDomain, true, `${name}: exact admitted domain`);
    }
    let aliased;
    let unowned;
    let external;
    const visit = node => {
      if (source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "aliased") aliased = node;
      if (source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "unowned") unowned = node;
      if (source.ast.is.IsReturnStatement(node) && source.ast.text(source.ast.name(source.ast.parent(source.ast.parent(node)))) === "construct")
        external = source.ast.as.AsReturnStatement(node).Expression;
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    assert.equal(aliased !== undefined && external !== undefined && unowned !== undefined, true);
    assert.equal(demand.closedStorageOriginsFor(aliased).kind === "complete", true, "immutable owned global constructor alias");
    assert.equal(demand.closedStorageOriginsFor(external).kind === "open", true, "signature identity does not own an external constructor value");
    const construct = source.ast.statements(file).find(node => source.ast.is.IsFunctionDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === "construct");
    assert.equal(demand.invalidationFor(source.ast.parameters(construct)[1], external, new Set()).kind === "unproven", true,
      "a valid external constructor is not evidence that a guarded Error read is preserved");
    assert.equal(demand.closedStorageOriginsFor(unowned).kind === "open", true, "ambient external values are not owned global constructors");
  });
  }
  for (const exported of [false, true]) {
    test(`Rust ${profileName} ${exported ? "external" : "private"} writable Error recovery uses the full origin domain`, () => {
      const { result } = compileRust({ surfaces: jsEnabled ? ["js"] : [], files: { "index.ts": errorRecoveryDomainSource(exported) } });
      const diagnostics = result.diagnostics.map(diagnostic => diagnostic.code).join(",");
      if (exported) {
        assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ERROR_WRITABLE_ORIGIN_MISSING"), true, diagnostics);
        assert.equal(result.artifacts.length === 0, true, "incomplete universal proof cannot publish lowered output");
      } else {
        assert.equal(result.diagnostics.length === 0, true, diagnostics);
        assert.equal(result.artifacts.some(artifact => artifact.path.endsWith(".rs") &&
          artifact.text.includes("WritableErrorObject::set_error_message")), true, "exact native setter retained");
      }
    });
  }
  for (const [footprint, expected] of [["mutating", "invalidated"], ["readonly", "preserved"], ["deferred", "preserved"],
    ["receiver", "preserved"], ["bound", "invalidated"]]) {
    test(`Rust ${profileName} native Error allocation preserves exact ${footprint} inherited initialization`, () => {
      const profile = collectTargetSourceProfileContributions({ project: {}, projectRoot: "/src", projectDirectory: "/src",
        target: { id: "rust", options: {} }, targetPackId: jsEnabled ? "js" : "rust", selectedCapabilities: [], selectedSurfaces: [],
        targetContributions: jsEnabled ? rustJsSurfaceSourceProfileContributions() : rustNativeSourceProfileContributions() });
      assert.equal(profile.diagnostics.length === 0, true);
      const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: new Map([
        ["/src/index.ts", errorConstructorFootprintSource(footprint)], ...profile.files.map(file => [file.path, file.text]),
      ]), compilerOptions: { strict: true, noLib: true, skipLibCheck: true, module: "esnext", moduleResolution: "bundler" } }).checkSource();
      assert.equal(checked.diagnostics.length === 0, true);
      const source = createTargetSourceProgram(checked);
      const file = source.sourceFiles.find(file => source.ast.getFileName(file) === "/src/index.ts");
      const profiles = createRustSourceProfileRegistry(source.sourceFiles, source.ast, jsEnabled);
      const demand = createRustErrorStorageDemandQuery(source, profiles, createSourceStorageQuery(source, [file], defaultSourceStorageLimits,
        createRustSourceProfileStorageEffects(source, profiles)), () => ({ kind: "ordinary" }));
      const declarations = new Map();
      const visit = node => {
        if (source.ast.is.IsVariableDeclaration(node)) declarations.set(source.ast.text(source.ast.name(node)), node);
        source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      visit(file);
      const owner = declarations.get("original");
      const expression = source.ast.as.AsVariableDeclaration(declarations.get("created"))?.Initializer;
      assert.equal(owner !== undefined && expression !== undefined, true);
      assert.equal(demand.isNativeConstructor(expression), true, "the inherited constructor selects the owned native Error protocol");
      assert.equal(demand.closedStorageOriginsFor(expression).kind === "complete", true, "fresh result ownership is complete but is not a purity proof");
      assert.equal(demand.invalidationFor(owner, expression, new Set()).kind, expected);
    });
  }
}
