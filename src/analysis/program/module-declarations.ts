import type { Node, SourceFile } from "@tsonic/tsts";
import { KindArrayBindingPattern, KindBindingElement, KindObjectBindingPattern, KindVariableDeclaration, KindVariableStatement, Node_Initializer, Node_Type, VariableDeclarationList_Declarations, VariableStatement_DeclarationList, sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";

import { resolveTypeNodeCarrier } from "../source-evidence/types/source-carriers.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { RustFactWalk } from "./walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { recordVariableDeclarationFacts } from "../control-flow/statements.js";

export function resolveRustModuleBindingValue(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  const { ast, records } = walk.context;
  let root: Node | undefined = declaration;
  while (root !== undefined && ast.kindName(root) !== KindVariableDeclaration) {
    const kind = ast.kindName(root);
    if (kind !== KindBindingElement && kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern) return undefined;
    root = ast.parent(root);
  }
  if (root === undefined || !sourceDeclarationIsModuleScoped(root, ast) || !walk.context.isNativeNode(root) ||
    walk.rejectedExpressions.has(root)) return undefined;
  if (records.moduleBinding.get(root) === undefined && !walk.resolving.has(root)) {
    const declarationList = ast.parent(root);
    const statement = declarationList === undefined ? undefined : ast.parent(declarationList);
    const sourceFile = ast.getSourceFile(root);
    if (statement === undefined || sourceFile === undefined || ast.kindName(statement) !== KindVariableStatement) return undefined;
    if (records.typeOnlyDeclarations.statement(walk, statement) !== undefined) return undefined;
    recordVariableDeclarationFacts(walk, root, sourceFile);
  }
  const binding = records.moduleBinding.get(declaration);
  if (binding?.storage === "native-callable") return binding.value?.carrier;
  if (binding?.storage === "module-cell" || binding?.storage === "native-const") return binding.valueCarrier;
  const projected = walk.resolving.has(root) ? records.bindingProjection.get(declaration) : undefined;
  if (projected !== undefined && "bindingCarrier" in projected) return projected.bindingCarrier;
  if (walk.resolving.has(root)) walk.moduleCycles.rejectActiveBinding(walk, root);
  return undefined;
}

export function recordRustModuleValueDeclarations(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast, records } = walk.context;
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined || ast.kindName(statement) !== KindVariableStatement) continue;
    const declarations = VariableDeclarationList_Declarations(ast, VariableStatement_DeclarationList(ast, statement));
    if (declarations === undefined) continue;
    for (const declaration of declarations) {
      if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration ||
        records.compileTimeSource.get(declaration) ||
        records.moduleBinding.get(declaration)?.storage === "native-callable") continue;
      recordDeclaration(walk, declaration);
    }
  }
}

function recordDeclaration(walk: RustFactWalk, declaration: Node): void {
  const { ast, records } = walk.context;
  const declarationKind = ast.variableDeclarationKind(declaration);
  if (declarationKind !== "const" && declarationKind !== "let" && declarationKind !== "var") return;
  const carrier = resolveTypeNodeCarrier(walk, Node_Type(ast, declaration));
  if (carrier === undefined || Node_Initializer(ast, declaration) !== undefined ||
    setCarrierFact(walk, declaration, carrier) === undefined) return;
  records.moduleBindings.value(walk, declaration, declarationKind, carrier);
}
