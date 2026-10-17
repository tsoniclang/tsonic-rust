import type { Node } from "@tsonic/tsts";
import {
  KindArrayBindingPattern,
  KindBindingElement,
  KindIdentifier,
  KindObjectBindingPattern,
  KindOmittedExpression,
  Node_Initializer,
  Node_Name,
  sourceDeclarationIsModuleScoped,
} from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustFactWalk } from "../program/walk.js";
import { recordVariableStatementFacts } from "../control-flow/statements.js";
import type { RustModuleBindingFact, RustModuleBindingPatternStep } from "../../target-model/records/operation-selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function resolveRustModulePatternBinding(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  const { ast, records } = walk.context;
  let root: Node | undefined = declaration;
  while (root !== undefined && ast.kindName(root) !== "KindVariableDeclaration") {
    const kind = ast.kindName(root);
    if (kind !== KindBindingElement && kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern) return undefined;
    root = ast.parent(root);
  }
  if (root === undefined || !sourceDeclarationIsModuleScoped(root, ast) || !walk.context.isNativeNode(root)) return undefined;
  if (records.moduleBinding.get(root)?.storage !== "module-pattern" && !walk.resolving.has(root)) {
    const declarationList = ast.parent(root);
    const statement = declarationList === undefined ? undefined : ast.parent(declarationList);
    const sourceFile = ast.getSourceFile(root);
    if (statement === undefined || sourceFile === undefined || ast.kindName(statement) !== "KindVariableStatement") return undefined;
    const previousCallable = walk.currentCallableDeclaration;
    const previousGenerator = walk.currentGeneratorDeclaration;
    walk.resolving.add(root);
    walk.currentCallableDeclaration = undefined;
    walk.currentGeneratorDeclaration = undefined;
    try {
      recordVariableStatementFacts(walk, statement, sourceFile);
    } finally {
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
      walk.resolving.delete(root);
    }
  }
  const binding = records.moduleBinding.get(declaration);
  if (binding?.storage === "module-cell") return binding.valueCarrier;
  const projected = walk.resolving.has(root) ? records.bindingProjection.get(declaration) : undefined;
  return projected !== undefined && "bindingCarrier" in projected ? projected.bindingCarrier : undefined;
}

export function selectRustModuleBindingPattern(
  declaration: Node,
  declarationKind: "const" | "let" | "var",
  valueCarrier: TargetTypeRef,
  context: RustAnalysisContext,
): Extract<RustModuleBindingFact, { readonly storage: "module-pattern" }> | undefined {
  const initializer = Node_Initializer(context.ast, declaration);
  const pattern = Node_Name(context.ast, declaration);
  if (initializer === undefined || pattern === undefined) return undefined;
  const steps: RustModuleBindingPatternStep[] = [];
  const collect = (name: Node, source: Node, sourceCarrier: TargetTypeRef): boolean => {
    for (const element of context.ast.elements(name)) {
      if (element === undefined) return false;
      if (context.ast.kindName(element) === KindOmittedExpression) continue;
      if (context.ast.kindName(element) !== KindBindingElement) return false;
      const projection = context.records.bindingProjection.get(element);
      if (projection === undefined ||
        !rustTargetTypeRefEquals(projection.sourceCarrier, sourceCarrier)) return false;
      if (!("bindingCarrier" in projection)) continue;
      const target = Node_Name(context.ast, element);
      if (target === undefined) return false;
      const targetKind = context.ast.kindName(target);
      if (targetKind !== KindIdentifier && targetKind !== KindArrayBindingPattern &&
        targetKind !== KindObjectBindingPattern) return false;
      const fallback = Node_Initializer(context.ast, element);
      steps.push(Object.freeze({ declaration: element, source,
        kind: targetKind === KindIdentifier ? "binding" : "pattern",
        ...(fallback === undefined ? {} : { initializer: fallback }) }));
      if (targetKind !== KindIdentifier && !collect(target, element, projection.bindingCarrier)) return false;
    }
    return true;
  };
  if (!collect(pattern, declaration, valueCarrier)) return undefined;
  return Object.freeze({ declarationKind, storage: "module-pattern", valueCarrier, initializer,
    steps: Object.freeze(steps) });
}
