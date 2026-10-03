import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustExternalProjectBase, resolveRustSourceErrorDeclaration } from "../../../dist/policy/types/external-project-types.js";

function contract() {
  const reference = name => ({ kind: "KindTypeReference", typeName: { text: name } });
  const field = text => ({ kind: "KindPropertySignature", name: { text } });
  const fields = [field("name"), field("message"), field("stack")];
  const signature = { kind: "KindConstructSignature", typeNode: reference("Error") };
  const declaration = { kind: "KindVariableDeclaration", name: { text: "Error" }, typeNode: reference("ErrorConstructor") };
  const instance = { kind: "KindInterfaceDeclaration", name: { text: "Error" }, members: fields };
  const constructor = { kind: "KindInterfaceDeclaration", name: { text: "ErrorConstructor" }, members: [signature] };
  const sourceFile = { statements: [instance, constructor] };
  const ast = {
    getSourceFile: () => sourceFile,
    kindName: node => node?.kind,
    text: node => node?.text,
    name: node => node?.name,
    typeNode: node => node?.typeNode,
    typeParameters: () => [],
    typeArguments: () => [],
    as: { AsTypeReferenceNode: node => ({ TypeName: node?.typeName }) },
    is: { IsIdentifier: node => node?.text !== undefined },
    members: node => node?.members ?? [],
    statements: file => file.statements,
    variableDeclarationKind: () => "var",
  };
  const profiles = { profileForNode: () => "native" };
  const edge = { kind: "extends", target: { declaration, project: false }, typeArguments: [], selectedTypeArguments: [] };
  return { ast, declaration, fields, instance, constructor, sourceFile, profiles, edge };
}

test("early native Error demand uses the same exact declaration owner as project inheritance", () => {
  const fixture = contract();
  const base = resolveRustSourceErrorDeclaration(fixture.declaration, fixture.ast, fixture.profiles);
  assert.ok(base);
  assert.deepEqual(base, resolveRustExternalProjectBase(fixture.edge, fixture.ast, fixture.profiles));
  assert.equal(base.declaration, fixture.instance);
  assert.deepEqual(base.fields.map(field => field.declaration), fixture.fields);
  assert.equal(base.constructorDeclarations[0], fixture.constructor.members[0]);
});

test("same-spelled user declarations cannot become native mutable Error demands", () => {
  const fixture = contract();
  assert.equal(resolveRustSourceErrorDeclaration(fixture.declaration, fixture.ast, { profileForNode: () => undefined }), undefined);
  assert.equal(resolveRustExternalProjectBase({ ...fixture.edge, target: { ...fixture.edge.target, project: true } },
    fixture.ast, fixture.profiles), undefined);
});

test("native Error declaration-root validation remains exact and fail closed", () => {
  const fixture = contract();
  assert.equal(resolveRustSourceErrorDeclaration(fixture.declaration,
    { ...fixture.ast, variableDeclarationKind: () => "let" }, fixture.profiles), undefined);
  assert.equal(resolveRustSourceErrorDeclaration(fixture.declaration,
    { ...fixture.ast, typeParameters: () => [{}] }, fixture.profiles), undefined);
  fixture.sourceFile.statements.push({ ...fixture.instance });
  assert.equal(resolveRustSourceErrorDeclaration(fixture.declaration, fixture.ast, fixture.profiles), undefined);
  fixture.sourceFile.statements.pop();
  fixture.fields.push({ ...fixture.fields[0] });
  assert.equal(resolveRustSourceErrorDeclaration(fixture.declaration, fixture.ast, fixture.profiles), undefined);
});
