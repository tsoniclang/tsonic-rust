import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { collectTargetSourceProfileContributions } from "../../../../../tsonic/packages/host/dist/target/source-profile.js";
import { rustNativeSourceProfileContributions } from "../../../../dist/source/profiles/declarations.js";
import { createRustSourceProfileRegistry } from "../../../../dist/analysis/project/source-profiles.js";
import { readRustSourceProfileErrorContract } from "../../../../dist/source/profiles/error-declarations.js";
import { resolveRustExternalProjectBase, resolveRustSourceErrorDeclaration } from "../../../../dist/policy/types/project/external-project-types.js";

const profilePath = "/src/.tsonic/source-profiles/rust/rust-globals.d.ts";

function fixture(body, rewriteProfile = text => text) {
  const profile = collectTargetSourceProfileContributions({
    project: {}, projectRoot: "/src", projectDirectory: "/src",
    target: { id: "rust", options: {} }, targetPackId: "rust",
    selectedCapabilities: [], selectedSurfaces: [],
    targetContributions: rustNativeSourceProfileContributions(),
  });
  assert.equal(profile.diagnostics.length, 0, "exact selected source profile");
  assert.equal(profile.files.some(file => file.path === profilePath), true, "native globals profile");
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: new Map([["/src/index.ts", body],
      ...profile.files.map(file => [file.path, file.path === profilePath ? rewriteProfile(file.text) : file.text])]),
    compilerOptions: { noLib: true, strict: true, skipLibCheck: true,
      module: "esnext", moduleResolution: "bundler", target: "es2022" },
  }).checkSource();
  const source = createTargetSourceProgram(checked);
  const file = checked.getSourceFile("/src/index.ts");
  const profileFile = checked.getSourceFile(profilePath);
  assert.equal(file !== undefined && profileFile !== undefined, true, "checked authored source and profile");
  const declarations = statements => statements.filter(node => node !== undefined);
  const classNamed = name => {
    const matching = declarations(source.ast.statements(file)).filter(node =>
      source.ast.is.IsClassDeclaration(node) && source.ast.text(source.ast.name(node)) === name);
    assert.equal(matching.length, 1, name);
    return matching[0];
  };
  const extendsEdge = name => {
    const heritage = source.navigation.declaredHeritage(classNamed(name));
    assert.equal(heritage.kind, "resolved", name);
    assert.equal(heritage.edges.length, 1, name);
    return heritage.edges[0];
  };
  const profileInterface = name => {
    const matching = declarations(source.ast.statements(profileFile)).filter(node =>
      source.ast.is.IsInterfaceDeclaration(node) && source.ast.text(source.ast.name(node)) === name);
    assert.equal(matching.length, 1, name);
    return matching[0];
  };
  return {
    checked, source, profileFile, extendsEdge, profileInterface,
    profiles: createRustSourceProfileRegistry(source, false),
  };
}

test("early native Error demand uses the same exact declaration owner as project inheritance", () => {
  const current = fixture("export class Failure extends Error {}");
  assert.equal(formatDiagnostics(current.checked.diagnostics.filter(value => value !== undefined), "/src"), "");
  const edge = current.extendsEdge("Failure");
  assert.equal(edge.target.project, false);
  assert.equal(current.source.ast.getFileName(current.source.ast.getSourceFile(edge.target.declaration)), profilePath);
  const base = resolveRustSourceErrorDeclaration(edge.target.declaration, current.profiles);
  assert.ok(base);
  assert.deepEqual(base, resolveRustExternalProjectBase(edge, current.profiles));
  const instance = current.profileInterface("Error");
  const constructor = current.profileInterface("ErrorConstructor");
  assert.equal(base.declaration, instance);
  assert.deepEqual(base.fields.map(field => field.declaration), current.source.ast.members(instance));
  assert.deepEqual(base.fields.map(field => field.sourceName), ["name", "message", "stack"]);
  assert.equal(base.constructorDeclarations.length, 1);
  assert.equal(base.constructorDeclarations[0], current.source.ast.members(constructor)
    .find(member => current.source.ast.kindName(member) === "KindConstructSignature"));
});

test("same-spelled user declarations cannot become native mutable Error demands", () => {
  const current = fixture(`
    interface ErrorConstructor { new (message?: string): object; }
    declare const Error: ErrorConstructor;
    export class Shadowed extends Error {}
    class Base {}
    export class Derived extends Base {}
  `);
  const shadowed = current.extendsEdge("Shadowed");
  assert.equal(current.source.ast.getFileName(current.source.ast.getSourceFile(shadowed.target.declaration)), "/src/index.ts");
  assert.equal(resolveRustSourceErrorDeclaration(shadowed.target.declaration, current.profiles), undefined);
  assert.equal(resolveRustExternalProjectBase(shadowed, current.profiles), undefined);
  const derived = current.extendsEdge("Derived");
  assert.equal(derived.target.project, true);
  assert.equal(resolveRustExternalProjectBase(derived, current.profiles), undefined);
});

test("native Error declaration-root validation remains exact and fail closed", () => {
  const exact = fixture("export {};");
  assert.ok(readRustSourceProfileErrorContract(exact.source, exact.profileFile));
  const errorInterface = "interface Error {\n  name: string;\n  message: string;\n  stack?: string;\n}";
  for (const [reason, rewrite] of [
    ["let-bound Error value", text => text.replace("declare var Error: ErrorConstructor;", "declare let Error: ErrorConstructor;")],
    ["generic Error instance", text => text.replace("interface Error {", "interface Error<T = unknown> {")],
    ["generic Error constructor", text => text.replace("interface ErrorConstructor {", "interface ErrorConstructor<T = unknown> {")],
    ["duplicate Error instance declaration", text => `${text}\n${errorInterface}\n`],
    ["duplicate Error field", text => text.replace(errorInterface, errorInterface.replace("  stack?: string;\n", "  stack?: string;\n  name: string;\n"))],
  ]) {
    const current = fixture("export {};", text => {
      const rewritten = rewrite(text);
      assert.notEqual(rewritten, text, reason);
      return rewritten;
    });
    assert.equal(readRustSourceProfileErrorContract(current.source, current.profileFile), undefined, reason);
  }
});
