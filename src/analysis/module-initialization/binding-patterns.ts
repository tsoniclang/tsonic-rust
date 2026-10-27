import type { Node } from "@tsonic/tsts";
import {
  KindArrayBindingPattern,
  KindBindingElement,
  KindIdentifier,
  KindObjectBindingPattern,
  KindOmittedExpression,
  Node_Initializer,
  Node_Name,
} from "@tsonic/target-api/source";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustModuleBindingFact, RustModuleBindingPatternStep } from "../../target-model/records/operations/operation-selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

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
