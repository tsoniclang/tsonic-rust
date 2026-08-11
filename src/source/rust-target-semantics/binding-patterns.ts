import type { AstReader, Node } from "@tsonic/tsts";
import {
  BindingElement_IsRest,
  BindingElement_PropertyName,
  KindArrayBindingPattern,
  KindBindingElement,
  KindIdentifier,
  KindNumericLiteral,
  KindObjectBindingPattern,
  KindOmittedExpression,
  KindStringLiteral,
  Node_Initializer,
  Node_Name,
} from "../../common/source-ast.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  rustBindingProjectionFactKey,
  type RustBindingNormalization,
  type RustBindingProjection,
} from "../rust-facts/keys.js";
import {
  isRustJsArrayCarrier,
  isRustVecCarrier,
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSourceTypeCarrierValue,
  rustTupleTargetType,
} from "../rust-target-types.js";
import type { RustTranslationContext } from "../../translate/context.js";
import type { RustSourceTypeRegistry } from "./source-type-registry.js";
import { rustProjectObjectLayout } from "./project-object-layout.js";

export interface RustBindingPatternFactContext {
  readonly ast: AstReader;
  readonly facts: RustTranslationContext["facts"];
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveCarrier: (subject: Node) => TargetTypeRef | undefined;
  readonly resolveExpressionCarrier: (
    expression: Node,
    expected: TargetTypeRef,
  ) => TargetTypeRef | undefined;
  readonly setCarrier: (subject: Node, carrier: TargetTypeRef) => void;
}

export function recordRustBindingPatternFacts(
  pattern: Node,
  sourceCarrier: TargetTypeRef,
  context: RustBindingPatternFactContext,
): boolean {
  const kind = context.ast.kindName(pattern);
  if (kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern) {
    return false;
  }
  context.setCarrier(pattern, sourceCarrier);
  const elements = context.ast.elements(pattern);
  for (const [index, element] of elements.entries()) {
    if (element === undefined || context.ast.kindName(element) === KindOmittedExpression) {
      continue;
    }
    if (context.ast.kindName(element) !== KindBindingElement || !context.ast.is.IsBindingElement(element)) {
      return false;
    }
    const name = Node_Name(context.ast, element);
    if (name === undefined) {
      return false;
    }
    const hasDefault = Node_Initializer(context.ast, element) !== undefined;
    const selected = kind === KindArrayBindingPattern
      ? selectArrayProjection(sourceCarrier, index, BindingElement_IsRest(context.ast, element), hasDefault)
      : selectObjectProjection(element, sourceCarrier, hasDefault, context);
    if (selected === undefined) {
      return false;
    }
    const bindingCarrier = selected.bindingCarrier;
    const initializer = Node_Initializer(context.ast, element);
    if (initializer !== undefined &&
      context.resolveExpressionCarrier(initializer, bindingCarrier) === undefined) {
      return false;
    }
    context.facts.set(element, rustBindingProjectionFactKey, {
      sourceCarrier,
      projectedCarrier: selected.projectedCarrier,
      bindingCarrier,
      projection: selected.projection,
      normalization: selected.normalization,
    }, [{ message: "rust finalized binding projection" }]);
    context.setCarrier(element, bindingCarrier);
    context.setCarrier(name, bindingCarrier);
    const nameKind = context.ast.kindName(name);
    if ((nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
      !recordRustBindingPatternFacts(name, bindingCarrier, context)) {
      return false;
    }
  }
  return true;
}

interface SelectedBindingProjection {
  readonly projectedCarrier: TargetTypeRef;
  readonly bindingCarrier: TargetTypeRef;
  readonly projection: RustBindingProjection;
  readonly normalization: RustBindingNormalization;
}

function selectArrayProjection(
  sourceCarrier: TargetTypeRef,
  index: number,
  rest: boolean,
  hasDefault: boolean,
): SelectedBindingProjection | undefined {
  if (rest) {
    if (hasDefault) {
      return undefined;
    }
    const projection: RustBindingProjection | undefined = sourceCarrier.kind === "tuple"
      ? { kind: "tuple-rest", start: index }
      : rustFixedArrayCarrierValue(sourceCarrier) !== undefined
        ? { kind: "fixed-array-rest", start: index }
        : isRustVecCarrier(sourceCarrier)
          ? { kind: "vec-rest", start: index }
          : isRustJsArrayCarrier(sourceCarrier)
            ? { kind: "js-array-rest", start: index }
            : undefined;
    const bindingCarrier = bindingCarrierForArrayRest(sourceCarrier, index);
    return projection === undefined || bindingCarrier === undefined
      ? undefined
      : { projectedCarrier: bindingCarrier, bindingCarrier, projection, normalization: "identity" };
  }

  let projectedCarrier: TargetTypeRef | undefined;
  let projection: RustBindingProjection | undefined;
  if (sourceCarrier.kind === "tuple") {
    projectedCarrier = sourceCarrier.elements[index];
    projection = { kind: "tuple-element", index };
  } else {
    const fixed = rustFixedArrayCarrierValue(sourceCarrier);
    if (fixed !== undefined && index < fixed.length) {
      projectedCarrier = fixed.element;
      projection = { kind: "fixed-array-element", index };
    } else if (isRustVecCarrier(sourceCarrier)) {
      projectedCarrier = hasDefault
        ? rustOptionTargetType(sourceCarrier.element)
        : sourceCarrier.element;
      projection = { kind: "vec-element", index, checked: hasDefault };
    } else if (isRustJsArrayCarrier(sourceCarrier)) {
      const elementCarrier = sourceCarrier.typeArguments?.[0];
      projectedCarrier = elementCarrier === undefined
        ? undefined
        : rustOptionTargetType(elementCarrier);
      projection = { kind: "js-array-element", index };
    }
  }
  const bindingCarrier = projectedCarrier === undefined
    ? undefined
    : bindingCarrierForProjectedValue(projectedCarrier, hasDefault);
  const normalization = projectedCarrier === undefined || bindingCarrier === undefined
    ? undefined
    : selectBindingNormalization(projectedCarrier, bindingCarrier, hasDefault);
  return projectedCarrier === undefined || bindingCarrier === undefined ||
      projection === undefined || normalization === undefined
    ? undefined
    : { projectedCarrier, bindingCarrier, projection, normalization };
}

function selectObjectProjection(
  element: Node,
  sourceCarrier: TargetTypeRef,
  hasDefault: boolean,
  context: RustBindingPatternFactContext,
): SelectedBindingProjection | undefined {
  if (BindingElement_IsRest(context.ast, element) || rustSourceTypeCarrierValue(sourceCarrier)?.shape !== "object") {
    return undefined;
  }
  const name = Node_Name(context.ast, element);
  const propertyName = BindingElement_PropertyName(context.ast, element) ?? name;
  const propertyKind = propertyName === undefined ? "" : context.ast.kindName(propertyName);
  if (propertyName === undefined ||
    (propertyKind !== KindIdentifier && propertyKind !== KindStringLiteral && propertyKind !== KindNumericLiteral)) {
    return undefined;
  }
  const declaration = context.sourceTypes.declarationForCarrier(sourceCarrier);
  const layout = declaration === undefined ? undefined : rustProjectObjectLayout(declaration, context.ast);
  const sourceName = context.ast.text(propertyName);
  const field = layout?.fields.find((candidate) => candidate.sourceName === sourceName);
  const projectedCarrier = field === undefined ? undefined : context.resolveCarrier(field.declaration);
  const bindingCarrier = projectedCarrier === undefined
    ? undefined
    : bindingCarrierForProjectedValue(projectedCarrier, hasDefault);
  const normalization = projectedCarrier === undefined || bindingCarrier === undefined
    ? undefined
    : selectBindingNormalization(projectedCarrier, bindingCarrier, hasDefault);
  return field === undefined || projectedCarrier === undefined || bindingCarrier === undefined || normalization === undefined
    ? undefined
    : {
        projectedCarrier,
        bindingCarrier,
        projection: { kind: "project-field", storageIndex: field.storageIndex },
        normalization,
      };
}

function bindingCarrierForArrayRest(
  sourceCarrier: TargetTypeRef,
  start: number,
): TargetTypeRef | undefined {
  if (sourceCarrier.kind === "tuple") {
    return rustTupleTargetType(sourceCarrier.elements.slice(start));
  }
  const fixed = rustFixedArrayCarrierValue(sourceCarrier);
  if (fixed !== undefined && start <= fixed.length) {
    return rustFixedArrayTargetType(fixed.element, fixed.length - start);
  }
  return isRustVecCarrier(sourceCarrier) || isRustJsArrayCarrier(sourceCarrier)
    ? sourceCarrier
    : undefined;
}

function bindingCarrierForProjectedValue(
  projectedCarrier: TargetTypeRef,
  hasDefault: boolean,
): TargetTypeRef | undefined {
  if (!hasDefault) {
    return projectedCarrier;
  }
  return rustOptionElementCarrier(projectedCarrier) ?? projectedCarrier;
}

function selectBindingNormalization(
  projectedCarrier: TargetTypeRef,
  bindingCarrier: TargetTypeRef,
  hasDefault: boolean,
): RustBindingNormalization | undefined {
  if (rustTargetTypeRefEquals(projectedCarrier, bindingCarrier)) {
    return "identity";
  }
  const projectedValue = rustOptionElementCarrier(projectedCarrier);
  const nestedValue = rustOptionElementCarrier(projectedValue);
  if (nestedValue !== undefined) {
    if (!hasDefault && rustTargetTypeRefEquals(projectedValue, bindingCarrier)) {
      return "flatten-option";
    }
    if (rustTargetTypeRefEquals(nestedValue, bindingCarrier)) {
      return hasDefault ? "flatten-default-on-none" : "flatten-expect-some";
    }
  }
  if (projectedValue !== undefined && rustTargetTypeRefEquals(projectedValue, bindingCarrier)) {
    return hasDefault ? "default-on-none" : "expect-some";
  }
  return undefined;
}
