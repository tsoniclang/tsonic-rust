import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustNativePropertyNameIssue } from "../objects/computed-field-names.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { BindingElement_IsRest, BindingElement_PropertyName, KindArrayBindingPattern, KindBindingElement, KindIdentifier, KindNumericLiteral, KindObjectBindingPattern, KindOmittedExpression, KindStringLiteral, Node_Initializer, Node_Name } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import type { RustSelectedBindingProjection } from "../../target-model/records/objects/value-projections.js";
import { selectRustBindingPatternProjection } from "../../policy/types/objects/binding-projection-policy.js";
import { isRustJsArrayCarrier, isRustVecCarrier, rustFixedArrayCarrierValue, rustSourceTypeCarrierValue, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../target-model/types/index.js";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustSourceTypeRegistry } from "../project-types/source-type-model.js";
import type { RustSourceObjectField } from "../../target-model/records/types/source-types.js";
import { isRustStructuralObjectFieldDeclaration } from "../../policy/types/objects/source-shapes.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { isRustAbsenceCarrier } from "../../target-model/types/carriers/native.js";

export interface RustBindingPatternFactContext {
  readonly requiredRecords: RustAnalysisContext["requiredRecords"];
  readonly ast: AstReader;
  readonly records: RustAnalysisContext["records"];
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
    expected: TargetTypeRef | undefined,
  ) => TargetTypeRef | undefined;
  readonly setCarrier: (subject: Node, carrier: TargetTypeRef) => void;
}

type RustBindingPatternRejection = {
  readonly kind: "rejected";
  readonly node: Node;
  readonly code: string;
  readonly reason: string;
};

export type RustBindingPatternAdmission =
  | { readonly kind: "recorded" }
  | { readonly kind: "unresolved" }
  | RustBindingPatternRejection;

const recordedBindingPattern: RustBindingPatternAdmission = Object.freeze({ kind: "recorded" });
const unresolvedBindingPattern: RustBindingPatternAdmission = Object.freeze({ kind: "unresolved" });

export function recordRustBindingPatternFacts(
  pattern: Node,
  sourceCarrier: TargetTypeRef,
  context: RustBindingPatternFactContext,
): RustBindingPatternAdmission {
  const kind = context.ast.kindName(pattern);
  if (kind !== KindArrayBindingPattern && kind !== KindObjectBindingPattern) {
    return unresolvedBindingPattern;
  }
  context.setCarrier(pattern, sourceCarrier);
  const elements = context.ast.elements(pattern);
  const objectExtractedNames = kind === KindObjectBindingPattern
    ? collectObjectExtractedNames(elements, context.ast, context.semanticsFor)
    : undefined;
  if (objectExtractedNames !== undefined && "kind" in objectExtractedNames) return objectExtractedNames;
  if (kind === KindObjectBindingPattern && objectExtractedNames === undefined) {
    return unresolvedBindingPattern;
  }
  for (const [index, element] of elements.entries()) {
    if (element === undefined || context.ast.kindName(element) === KindOmittedExpression) {
      continue;
    }
    if (context.ast.kindName(element) !== KindBindingElement || !context.ast.is.IsBindingElement(element)) {
      return unresolvedBindingPattern;
    }
    const name = Node_Name(context.ast, element);
    if (name === undefined) {
      if (kind !== KindArrayBindingPattern || BindingElement_IsRest(context.ast, element) ||
        Node_Initializer(context.ast, element) !== undefined ||
        BindingElement_PropertyName(context.ast, element) !== undefined ||
        !(sourceCarrier.kind === "tuple" || rustFixedArrayCarrierValue(sourceCarrier) !== undefined ||
          isRustVecCarrier(sourceCarrier) || isRustJsArrayCarrier(sourceCarrier))) return unresolvedBindingPattern;
      context.records.bindingProjections.omitted(context.requiredRecords, element, sourceCarrier);
      continue;
    }
    const initializer = Node_Initializer(context.ast, element);
    const selected = kind === KindArrayBindingPattern
      ? selectRustBindingPatternProjection(sourceCarrier, index, BindingElement_IsRest(context.ast, element), initializer !== undefined)
      : selectObjectProjection(
          element,
          sourceCarrier,
          initializer !== undefined,
          objectExtractedNames!,
          context,
        );
    if (selected === undefined) {
      return unresolvedBindingPattern;
    }
    if ("kind" in selected) return selected;
    const defaultExpected = rustOptionElementCarrier(selected.projectedCarrier) ??
      rustOptionalStorageValue(selected.projectedCarrier) ?? selected.projectedCarrier;
    const defaultCarrier = initializer === undefined ? undefined
      : context.resolveExpressionCarrier(initializer, isRustAbsenceCarrier(defaultExpected) ? undefined : defaultExpected);
    if (initializer !== undefined && defaultCarrier === undefined) return unresolvedBindingPattern;
    const projected = context.records.bindingProjections.resolve(context.requiredRecords, element, sourceCarrier,
      selected.projectedCarrier, selected.projection, defaultCarrier, selected.checkedArrayElement);
    if (projected === undefined) return unresolvedBindingPattern;
    const { bindingCarrier } = projected;
    context.setCarrier(element, bindingCarrier);
    context.setCarrier(name, bindingCarrier);
    const nameKind = context.ast.kindName(name);
    if (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) {
      const nested = recordRustBindingPatternFacts(name, bindingCarrier, context);
      if (nested.kind !== "recorded") return nested;
    }
  }
  return recordedBindingPattern;
}

function selectObjectProjection(
  element: Node,
  sourceCarrier: TargetTypeRef,
  hasDefault: boolean,
  extractedSourceNames: ReadonlySet<string>,
  context: RustBindingPatternFactContext,
): RustSelectedBindingProjection | RustBindingPatternRejection | undefined {
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
    const bindingCarrier = resolveObjectRestBindingCarrier(
      name,
      remaining,
      sourceCarrier,
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
        };
  }
  const propertyName = BindingElement_PropertyName(context.ast, element) ?? name;
  const sourceName = bindingPropertySourceName(propertyName, context.ast, context.semanticsFor);
  if (sourceName === undefined) {
    return undefined;
  }
  if (typeof sourceName !== "string") return sourceName;
  const field = sourceShape.fields.find((candidate) =>
    candidate.sourceName === sourceName);
  if (field?.method === true) {
    return undefined;
  }
  const projectedCarrier = field?.carrier;
  return field === undefined || projectedCarrier === undefined
    ? undefined
    : {
        projectedCarrier,
        projection: {
          kind: "object-field",
          storage: sourceShape.storage,
          storageIndex: field.storageIndex,
          ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        },
      };
}

interface ObjectBindingSource {
  readonly storage: "project-object" | "structural-object";
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
      storage: "structural-object",
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
    : rustProjectObjectLayout(declaration, context.ast, context.semanticsFor);
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
    readonly method?: true;
  }[],
  sourceCarrier: TargetTypeRef,
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
  const source = rustStructuralObjectCarrierValue(sourceCarrier);
  const implementation = source?.implementation === undefined ? undefined : { ...source.implementation,
    methods: source.implementation.methods.filter(method => fields.some(field => field.method && field.sourceName === method.sourceName)) };
  const carrier = rustStructuralObjectTargetType(ownerFileName, fields.map((field) => ({
    sourceName: field.sourceName,
    type: field.carrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.method === true ? { method: true as const } : {}),
  })), source?.representation, undefined, [], implementation?.methods.length === 0 ? undefined : implementation);
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
      ...(field.method === true ? { method: true as const } : {}),
    };
  });
  return registeredFields.some((field) => field === undefined) ||
      !context.sourceTypes.registerStructuralObject({
        sourceType,
        carrier,
        storage: "structural-object",
        fields: registeredFields as readonly RustSourceObjectField[],
      }, { kind: "root" })
    ? undefined
    : carrier;
}

function collectObjectExtractedNames(
  elements: readonly (Node | undefined)[],
  ast: AstReader,
  semanticsFor: RustBindingPatternFactContext["semanticsFor"],
): ReadonlySet<string> | RustBindingPatternRejection | undefined {
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
      semanticsFor,
    );
    if (sourceName === undefined) {
      return undefined;
    }
    if (typeof sourceName !== "string") return sourceName;
    names.add(sourceName);
  }
  return names;
}

function bindingPropertySourceName(
  propertyName: Node | undefined,
  ast: AstReader,
  semanticsFor: RustBindingPatternFactContext["semanticsFor"],
): string | RustBindingPatternRejection | undefined {
  if (propertyName !== undefined && (ast.is.IsComputedPropertyName(propertyName) || ast.is.IsNumericLiteral(propertyName))) {
    const selected = semanticsFor(propertyName).propertyNames.get(propertyName);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "A native binding property requires its completed checked property-name selection.", propertyName);
    if (selected.kind === "resolved") return selected.name;
    const issue = rustNativePropertyNameIssue(propertyName, selected);
    return issue === undefined ? undefined : Object.freeze({ kind: "rejected", node: propertyName,
      code: issue.code, reason: issue.message });
  }
  const kind = propertyName === undefined ? "" : ast.kindName(propertyName);
  return propertyName === undefined ||
      (kind !== KindIdentifier && kind !== KindStringLiteral && kind !== KindNumericLiteral)
    ? undefined
    : ast.text(propertyName);
}

export function recordBindingPatternFacts(
  walk: RustFactWalk,
  pattern: Node,
  sourceCarrier: TargetTypeRef,
): boolean {
  const admission = recordRustBindingPatternFacts(pattern, sourceCarrier, {
    ast: walk.context.ast,
    records: walk.context.records,
    requiredRecords: walk.context.requiredRecords,
    navigation: walk.context.source.navigation,
    semanticsFor: walk.context.semanticsFor,
    sourceTypes: walk.sourceTypes,
    resolveCarrier: (subject) => resolveRustTargetTypeRef(
      subject,
      rustResolutionContext(walk, subject),
      walk.operationOptions,
    ),
    resolveProjectFieldCarrier: (declaration, receiverCarrier) => {
      const declaredCarrier = resolveRustTargetTypeRef(
        declaration,
        rustResolutionContext(walk, declaration),
        walk.operationOptions,
      );
      return declaredCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            declaration,
            receiverCarrier,
            declaredCarrier,
          );
    },
    resolveExpressionCarrier: (expression, expected) => resolveExpressionCarrier(
      walk,
      expression,
      walk.context.semanticsFor(expression).sourceFile,
      expected,
    ),
    setCarrier: (subject, carrier) => {
      setCarrierFact(walk, subject, carrier);
    },
  });
  if (admission.kind === "rejected") appendRustDiagnostic(walk, admission.code, admission.reason, admission.node, []);
  return admission.kind === "recorded";
}
