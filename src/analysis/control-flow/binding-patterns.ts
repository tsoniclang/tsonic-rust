import type { AstReader, Node } from "@tsonic/tsts";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
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
} from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import {
  rustBindingProjectionFactKey,
  type RustBindingNormalization,
  type RustBindingProjection,
} from "../facts/keys.js";
import {
  isRustJsArrayCarrier,
  rustJsArrayLikeElementTargetType,
  isRustVecCarrier,
  rustFixedArrayCarrierValue,
  rustFixedArrayTargetType,
  rustTargetConstSafeInteger,
  rustOptionElementCarrier,
  rustOptionTargetType,
  rustSourceTypeCarrierValue,
  rustStructuralObjectCarrierValue,
  rustStructuralObjectTargetType,
  rustTupleTargetType,
} from "../../target-model/types/index.js";
import type { RustAnalysisContext } from "../program/context.js";
import type {
  RustSourceObjectField,
  RustSourceTypeRegistry,
} from "../project-types/source-type-registry.js";
import { isRustStructuralObjectFieldDeclaration } from "../../policy/types/source-shapes.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";

export interface RustBindingPatternFactContext {
  readonly ast: AstReader;
  readonly facts: RustAnalysisContext["facts"];
  readonly navigation: RustAnalysisContext["source"]["navigation"];
  readonly semanticsFor: RustAnalysisContext["semanticsFor"];
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly resolveCarrier: (subject: Node) => TargetTypeRef | undefined;
  readonly resolveProjectFieldCarrier: (
    declaration: Node,
    receiverCarrier: TargetTypeRef,
  ) => TargetTypeRef | undefined;
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
  const objectExtractedNames = kind === KindObjectBindingPattern
    ? collectObjectExtractedNames(elements, context.ast)
    : undefined;
  if (kind === KindObjectBindingPattern && objectExtractedNames === undefined) {
    return false;
  }
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
      : selectObjectProjection(
          element,
          sourceCarrier,
          hasDefault,
          objectExtractedNames!,
          context,
        );
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
    const fixedLength = fixed === undefined
      ? undefined
      : rustTargetConstSafeInteger(fixed.length);
    if (fixed !== undefined && fixedLength !== undefined && index < fixedLength) {
      projectedCarrier = fixed.element;
      projection = { kind: "fixed-array-element", index };
    } else if (isRustVecCarrier(sourceCarrier)) {
      projectedCarrier = hasDefault
        ? rustOptionTargetType(sourceCarrier.element)
        : sourceCarrier.element;
      projection = { kind: "vec-element", index, checked: hasDefault };
    } else if (isRustJsArrayCarrier(sourceCarrier)) {
      const elementCarrier = rustJsArrayLikeElementTargetType(sourceCarrier);
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
  extractedSourceNames: ReadonlySet<string>,
  context: RustBindingPatternFactContext,
): SelectedBindingProjection | undefined {
  const sourceShape = resolveObjectBindingSource(sourceCarrier, context);
  if (sourceShape === undefined) {
    return undefined;
  }
  const name = Node_Name(context.ast, element);
  if (BindingElement_IsRest(context.ast, element)) {
    if (hasDefault || name === undefined || context.ast.kindName(name) !== KindIdentifier) {
      return undefined;
    }
    const remaining = sourceShape.fields.filter((field) =>
      !extractedSourceNames.has(field.sourceName));
    if (remaining.some((field) => field.method === true)) {
      return undefined;
    }
    const bindingCarrier = resolveObjectRestBindingCarrier(
      name,
      remaining,
      context,
    );
    const targetShape = bindingCarrier === undefined
      ? undefined
      : rustStructuralObjectCarrierValue(bindingCarrier);
    if (bindingCarrier === undefined || targetShape === undefined ||
      targetShape.fields.length !== remaining.length) {
      return undefined;
    }
    const fields = targetShape.fields.map((targetField, targetStorageIndex) => {
      const sourceField = remaining.find((field) =>
        field.sourceName === targetField.sourceName);
      return sourceField === undefined ||
          !rustTargetTypeRefEquals(sourceField.carrier, targetField.type)
        ? undefined
        : {
            sourceStorageIndex: sourceField.storageIndex,
            targetStorageIndex,
            carrier: sourceField.carrier,
            ...(sourceField.accessor === undefined
              ? {}
              : { accessor: sourceField.accessor }),
          };
    });
    return fields.some((field) => field === undefined)
      ? undefined
      : {
          projectedCarrier: bindingCarrier,
          bindingCarrier,
          projection: {
            kind: "object-rest",
            storage: sourceShape.storage,
            fields: fields as readonly {
              readonly sourceStorageIndex: number;
              readonly targetStorageIndex: number;
              readonly carrier: TargetTypeRef;
              readonly accessor?: {
                readonly getter: true;
                readonly setter: boolean;
              };
            }[],
          },
          normalization: "identity",
        };
  }
  const propertyName = BindingElement_PropertyName(context.ast, element) ?? name;
  const sourceName = bindingPropertySourceName(propertyName, context.ast);
  if (sourceName === undefined) {
    return undefined;
  }
  const field = sourceShape.fields.find((candidate) =>
    candidate.sourceName === sourceName);
  if (field?.method === true) {
    return undefined;
  }
  const projectedCarrier = field?.carrier;
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
        projection: {
          kind: "object-field",
          storage: sourceShape.storage,
          storageIndex: field.storageIndex,
          ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        },
        normalization,
      };
}

interface ObjectBindingSource {
  readonly storage: "project-object" | "object-handle";
  readonly fields: readonly {
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
}

function resolveObjectBindingSource(
  sourceCarrier: TargetTypeRef,
  context: RustBindingPatternFactContext,
): ObjectBindingSource | undefined {
  const structural = rustStructuralObjectCarrierValue(sourceCarrier);
  if (structural !== undefined) {
    return {
      storage: "object-handle",
      fields: structural.fields.map((field, storageIndex) => ({
        sourceName: field.sourceName,
        storageIndex,
        carrier: field.type,
        presence: field.presence,
        readonly: field.readonly,
        ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        ...(field.method === true ? { method: true as const } : {}),
      })),
    };
  }
  if (rustSourceTypeCarrierValue(sourceCarrier)?.shape !== "object") {
    return undefined;
  }
  const declaration = context.sourceTypes.declarationForCarrier(sourceCarrier);
  const layout = declaration === undefined
    ? undefined
    : rustProjectObjectLayout(declaration, context.ast);
  if (declaration === undefined || layout === undefined ||
    context.ast.extendsHeritageElements(declaration).length !== 0) {
    return undefined;
  }
  const fields = layout.fields.map((field) => {
    const carrier = context.resolveProjectFieldCarrier(
      field.declaration,
      sourceCarrier,
    );
    return carrier === undefined
      ? undefined
      : {
          sourceName: field.sourceName,
          storageIndex: field.storageIndex,
          carrier,
          presence: "required" as const,
          readonly: false,
        };
  });
  return fields.some((field) => field === undefined)
    ? undefined
    : {
        storage: "project-object",
        fields: fields as readonly {
          readonly sourceName: string;
          readonly storageIndex: number;
          readonly carrier: TargetTypeRef;
          readonly presence: "required";
          readonly readonly: false;
        }[],
      };
}

function resolveObjectRestBindingCarrier(
  binding: Node,
  fields: readonly {
    readonly sourceName: string;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
  }[],
  context: RustBindingPatternFactContext,
): TargetTypeRef | undefined {
  const semantics = context.semanticsFor(binding);
  const sourceType = semantics.types.expressionType(binding);
  if (sourceType === undefined) {
    return undefined;
  }
  const properties = semantics.types.propertyInfos(sourceType);
  if (properties.length !== fields.length ||
    new Set(properties.map((property) => property.name)).size !== properties.length ||
    new Set(fields.map((field) => field.sourceName)).size !== fields.length) {
    return undefined;
  }
  const ownerFileName = context.ast.getFileName(context.ast.getSourceFile(binding));
  const carrier = rustStructuralObjectTargetType(ownerFileName, fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.carrier,
    presence: field.presence,
    readonly: field.readonly,
  })));
  const canonical = rustStructuralObjectCarrierValue(carrier);
  if (canonical === undefined) {
    return undefined;
  }
  const registeredFields = canonical.fields.map((field, storageIndex) => {
    const property = properties.find((candidate) =>
      candidate.name === field.sourceName);
    const propertyType = property?.type;
    const declarations = property === undefined
      ? undefined
      : semantics.declarations.symbolDeclarations(property.symbol);
    if (property === undefined || propertyType === undefined ||
      declarations === undefined || declarations.length === 0 ||
      !isDenseDataArray(declarations) || declarations.some((declaration) => declaration === undefined) ||
      declarations.some((declaration) =>
        !context.navigation.isProjectDeclaration(declaration!) ||
        !isRustStructuralObjectFieldDeclaration(declaration!, context.ast))) {
      return undefined;
    }
    return {
      declarations: Object.freeze([...declarations] as Node[]),
      symbols: Object.freeze([property.symbol]),
      sourceName: field.sourceName,
      sourceType: propertyType,
      storageIndex,
      resultCarrier: field.type,
      presence: property.optional ? "optional" as const : "required" as const,
      readonly: property.readonly,
    };
  });
  return registeredFields.some((field) => field === undefined) ||
      !context.sourceTypes.registerStructuralObject({
        sourceType,
        carrier,
        storage: "object-handle",
        fields: registeredFields as readonly RustSourceObjectField[],
      })
    ? undefined
    : carrier;
}

function collectObjectExtractedNames(
  elements: readonly (Node | undefined)[],
  ast: AstReader,
): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  for (const element of elements) {
    if (element === undefined || ast.kindName(element) === KindOmittedExpression ||
      ast.kindName(element) !== KindBindingElement || !ast.is.IsBindingElement(element)) {
      return undefined;
    }
    if (BindingElement_IsRest(ast, element)) {
      continue;
    }
    const name = Node_Name(ast, element);
    const sourceName = bindingPropertySourceName(
      BindingElement_PropertyName(ast, element) ?? name,
      ast,
    );
    if (sourceName === undefined) {
      return undefined;
    }
    names.add(sourceName);
  }
  return names;
}

function bindingPropertySourceName(
  propertyName: Node | undefined,
  ast: AstReader,
): string | undefined {
  const kind = propertyName === undefined ? "" : ast.kindName(propertyName);
  return propertyName === undefined ||
      (kind !== KindIdentifier && kind !== KindStringLiteral && kind !== KindNumericLiteral)
    ? undefined
    : ast.text(propertyName);
}

function bindingCarrierForArrayRest(
  sourceCarrier: TargetTypeRef,
  start: number,
): TargetTypeRef | undefined {
  if (sourceCarrier.kind === "tuple") {
    return rustTupleTargetType(sourceCarrier.elements.slice(start));
  }
  const fixed = rustFixedArrayCarrierValue(sourceCarrier);
  const fixedLength = fixed === undefined
    ? undefined
    : rustTargetConstSafeInteger(fixed.length);
  if (fixed !== undefined && fixedLength !== undefined && start <= fixedLength) {
    return rustFixedArrayTargetType(fixed.element, fixedLength - start);
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
