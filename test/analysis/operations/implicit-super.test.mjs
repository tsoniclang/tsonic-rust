import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustSession, checkRustSession } from "../../helpers/rust-session.mjs";
import { selectedImplicitSuperConstructorClass } from "../../../dist/analysis/operations/provider/calls/implicit-super.js";

test("implicit super selection requires the exact selected return owner and parameters", () => {
  const checked = checkRustSession(createRustSession({ files: { "index.ts": `
abstract class Base<T> { abstract read(): T; }
class Foreign {}
class Derived extends Base<number> {
  constructor() { super(); }
  read(): number { return 1; }
}
export function run(): void { new Derived(); new Foreign(); }
` } }));
  const source = createTargetSourceProgram(checked);
  const { ast } = source;
  const file = checked.getSourceFile("/src/index.ts");
  const classes = ast.statements(file).filter(node => ast.is.IsClassDeclaration(node));
  const [base, foreign, derived] = classes.map(declaration => ({ kind: "class", declaration }));
  let superInfo;
  let foreignSignature;
  const visit = node => {
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
      const info = source.semantics.forNode(node).operations.call(node);
      if (info !== undefined && ast.kindName(info.sourceCallee.expression) === "KindSuperKeyword") superInfo = info;
      if (info !== undefined && ast.is.IsNewExpression(node)) {
        const semantics = source.semantics.forNode(node);
        const symbol = semantics.declarations.typeSymbol(semantics.types.returnType(info.selectedSignature));
        if (semantics.declarations.symbolDeclarations(symbol).includes(foreign.declaration)) foreignSignature = info.selectedSignature;
      }
    }
    ast.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(superInfo);
  assert.ok(foreignSignature);
  const signatures = source.navigation.classConstructors(base.declaration);
  assert.equal(signatures.kind, "resolved");
  assert.equal(signatures.signatures.some(signature => signature.signature === superInfo.selectedSignature), false);
  const projectTypes = {
    definitionContainingDeclaration() { return derived; },
    heritageForDefinition() { return [{ kind: "extends", target: base }]; },
    constructorForSignature() { return undefined; },
    constructorsForDefinition() { return signatures.signatures; },
  };
  const request = { source: superInfo };
  const context = { ast, source };
  assert.equal(selectedImplicitSuperConstructorClass(request, context, { projectTypes }), base.declaration);
  assert.equal(selectedImplicitSuperConstructorClass({ source: { ...superInfo, selectedSignature: foreignSignature } },
    context, { projectTypes }), undefined);
  assert.equal(selectedImplicitSuperConstructorClass({ source: { ...superInfo, sourceSelectedSignatureParameters: [{}] } },
    context, { projectTypes }), undefined);
  assert.equal(selectedImplicitSuperConstructorClass(request, context, {
    projectTypes: { ...projectTypes, heritageForDefinition() { return [{ kind: "extends", target: foreign }]; } },
  }), undefined);
  assert.equal(selectedImplicitSuperConstructorClass(request, context, {
    projectTypes: { ...projectTypes, heritageForDefinition() { return [
      { kind: "extends", target: base }, { kind: "extends", target: base },
    ]; } },
  }), undefined);
});
