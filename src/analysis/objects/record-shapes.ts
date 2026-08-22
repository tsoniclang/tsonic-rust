import {
  isRustIntegerCarrier,
  isRustStringCarrier,
  rustCallableTargetType,
  rustClosureTargetType,
  rustPropertySourceMemberKey,
  rustSourceTypeCarrierValue,
  rustStructuralObjectCarrierValue,
  rustCarrierSupportsClone,
} from "../../target-model/types/index.js";
import {
  KindSpreadAssignment,
  Node_Type,
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveParameterAbi } from "../declarations/types-and-bindings.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { resolveTypeNodeCarrier } from "../control-flow/statements.js";
import { rustGeneratorFactKey, rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey } from "../facts/keys.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import { rustResolutionContext } from "../program/walk.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustSourceUnion, RustSourceUnionVariant } from "../project-types/source-type-registry.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceMemberKey } from "../../target-model/types/index.js";

export function resolveProjectMethodPropertyCarrier(
  walk: RustFactWalk,
  declaration: Node,
  receiverCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  const owner = walk.context.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined
    ? undefined
    : walk.context.projectTypes.relationship(receiverCarrier, owner);
  const parameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.parameters(declaration),
    "Project method property contains an undefined parameter slot.",
  );
  if (relationship?.kind !== "related" || parameters === undefined ||
    walk.context.ast.typeParameters(declaration).length !== 0 ||
    walk.context.ast.hasModifierKind(declaration, "async") ||
    walk.context.facts.get(declaration, rustGeneratorFactKey) !== undefined) {
    return undefined;
  }
  const parameterCarriers = parameters.map((parameter) => {
    const abi = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey);
    return abi?.form === "required" && abi.mode === "value"
      ? walk.context.projectTypes.instantiateMemberCarrier(
          parameter,
          relationship.targetType,
          abi.parameterCarrier,
        )
      : undefined;
  });
  const returnCarrier = walk.context.facts.get(
    declaration,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier;
  const resultCarrier = returnCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        declaration,
        relationship.targetType,
        returnCarrier,
      );
  return resultCarrier === undefined || parameterCarriers.some((carrier) => carrier === undefined)
    ? undefined
    : rustCallableTargetType(
        parameterCarriers as TargetTypeRef[],
        resultCarrier,
      );
}

export function resolveProjectIndexRecordLiteral(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  resultCarrier: TargetTypeRef,
  properties: readonly Node[],
  definition: import("../project-types/type-policy.js").RustProjectTypeDefinition,
  layout: import("../project-types/object-layout.js").RustProjectObjectLayout,
): TargetTypeRef | undefined {
  if (definition.kind !== "interface" || layout.indexSignatures.length !== 1 ||
    layout.fields.length !== 0 ||
    walk.context.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const index = layout.indexSignatures[0]!;
  const declaredKeyCarrier = walk.context.facts.get(index.keyParameter, rustRuntimeCarrierKey)?.carrier ??
    resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, index.keyParameter));
  const declaredValueCarrier = walk.context.facts.get(index.declaration, rustRuntimeCarrierKey)?.carrier ??
    resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, index.declaration));
  const keyCarrier = declaredKeyCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        index.keyParameter,
        resultCarrier,
        declaredKeyCarrier,
      );
  const valueCarrier = declaredValueCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        index.declaration,
        resultCarrier,
        declaredValueCarrier,
      );
  const storageName = walk.context.projectTypes.fieldStorageName(
    definition,
    index.declaration,
  );
  if (keyCarrier === undefined || valueCarrier === undefined || storageName === undefined ||
    (!isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier)) ||
    !rustCarrierSupportsClone(valueCarrier)) {
    return undefined;
  }
  const contributions: Extract<
    RustTargetOperationFact,
    { readonly kind: "record-index-literal" }
  >["contributions"][number][] = [];
  for (const property of properties) {
    const kind = walk.context.ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      const spreadExpression = SpreadAssignment_Expression(walk.context.ast, property);
      const sourceCarrier = spreadExpression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, spreadExpression, sourceFile, undefined);
      const sourceDefinition = sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.definitionForCarrier(sourceCarrier);
      const sourceLayout = sourceDefinition?.kind === "interface"
        ? rustProjectObjectLayout(sourceDefinition.declaration, walk.context.ast)
        : undefined;
      const sourceIndex = sourceLayout?.indexSignatures.length === 1 &&
          sourceLayout.fields.length === 0 && !walk.context.projectTypes.isPolymorphic(sourceDefinition!)
        ? sourceLayout.indexSignatures[0]
        : undefined;
      const sourceDeclaredKey = sourceIndex === undefined
        ? undefined
        : walk.context.facts.get(sourceIndex.keyParameter, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, sourceIndex.keyParameter));
      const sourceDeclaredValue = sourceIndex === undefined
        ? undefined
        : walk.context.facts.get(sourceIndex.declaration, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, sourceIndex.declaration));
      const sourceKey = sourceDeclaredKey === undefined || sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            sourceIndex!.keyParameter,
            sourceCarrier,
            sourceDeclaredKey,
          );
      const sourceValue = sourceDeclaredValue === undefined || sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            sourceIndex!.declaration,
            sourceCarrier,
            sourceDeclaredValue,
          );
      const sourceStorageName = sourceDefinition === undefined || sourceIndex === undefined
        ? undefined
        : walk.context.projectTypes.fieldStorageName(sourceDefinition, sourceIndex.declaration);
      if (spreadExpression === undefined || sourceCarrier === undefined || sourceIndex === undefined ||
        sourceStorageName === undefined || !rustTargetTypeRefEquals(sourceKey, keyCarrier) ||
        !rustTargetTypeRefEquals(sourceValue, valueCarrier)) {
        return undefined;
      }
      contributions.push({
        kind: "spread",
        property,
        expression: spreadExpression,
        sourceCarrier,
        sourceStorageName,
      });
      continue;
    }
    if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") {
      return undefined;
    }
    const name = walk.context.ast.name(property);
    const sourceName = name === undefined ? "" : walk.context.ast.text(name);
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (sourceName.length === 0 || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, valueCarrier) === undefined) {
      return undefined;
    }
    contributions.push({
      kind: "property",
      property,
      sourceName,
      expression: initializer,
    });
  }
  setRustOperationFact(walk, expression, {
    kind: "record-index-literal",
    operationId: "tsonic.rust.record.index-literal",
    resultCarrier,
    keyCarrier,
    valueCarrier,
    storageName,
    contributions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

export function resolveObjectLiteralMethodCarrier(
  walk: RustFactWalk,
  method: Node,
  selectedType: Type,
  implementationType: Type,
): TargetTypeRef | undefined {
  const typeParameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.typeParameters(method),
    "Authored object-literal method contains an undefined type-parameter slot.",
  );
  const parameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.parameters(method),
    "Authored object-literal method contains an undefined parameter slot.",
  );
  const authoredReturnType = Node_Type(walk.context.ast, method);
  if (parameters !== undefined && authoredReturnType !== undefined &&
    parameters.every((parameter) => Node_Type(walk.context.ast, parameter) !== undefined)) {
    const parameterCarriers = parameters.map((parameter) =>
      resolveParameterAbi(walk, parameter)?.parameterCarrier);
    const returnCarrier = resolveTypeNodeCarrier(walk, authoredReturnType);
    if (returnCarrier !== undefined && !parameterCarriers.some((carrier) => carrier === undefined)) {
      return rustClosureTargetType(
        parameterCarriers as readonly TargetTypeRef[],
        returnCarrier,
      );
    }
  }
  const selected = resolveRustTargetTypeRef(
    selectedType,
    rustResolutionContext(walk, method),
    walk.operationOptions,
  );
  if (selected !== undefined) {
    return selected;
  }
  const returnCarrier = walk.context.facts.get(
    method,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier ?? walk.context.facts.resolve(
    method,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier ?? resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, method));
  if (typeParameters !== undefined && typeParameters.length > 0 &&
    parameters !== undefined && returnCarrier !== undefined) {
    const parameterCarriers = parameters.map((parameter) =>
      (walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey) ??
        resolveParameterAbi(walk, parameter))?.parameterCarrier);
    if (!parameterCarriers.some((carrier) => carrier === undefined)) {
      return rustClosureTargetType(
        parameterCarriers as readonly TargetTypeRef[],
        returnCarrier,
      );
    }
  }
  return resolveRustTargetTypeRef(
    implementationType,
    rustResolutionContext(walk, method),
    walk.operationOptions,
  );
}

interface RustResolvedRecordShape {
  readonly storage: "project-object" | "object-handle";
  readonly fields: readonly {
    readonly sourceKey: RustSourceMemberKey;
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
}

export function resolveRustRecordShape(
  walk: RustFactWalk,
  carrier: TargetTypeRef,
  requireInterface: boolean,
): RustResolvedRecordShape | undefined {
  const sourceValue = rustSourceTypeCarrierValue(carrier);
  if (sourceValue?.shape === "object") {
    const shapeDeclaration = walk.sourceTypes.declarationForCarrier(carrier);
    const layout = shapeDeclaration === undefined
      ? undefined
      : rustProjectObjectLayout(shapeDeclaration, walk.context.ast);
    if (layout === undefined || requireInterface && layout.kind !== "interface") {
      return undefined;
    }
    const fields = layout.fields.map((field) => {
      const declared = walk.context.facts.get(field.declaration, rustRuntimeCarrierKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
      const instantiated = declared === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            field.declaration,
            carrier,
            declared,
          );
      return instantiated === undefined
        ? undefined
        : {
            sourceKey: rustPropertySourceMemberKey(field.sourceName),
            sourceName: field.sourceName,
            storageIndex: field.storageIndex,
            carrier: instantiated,
            presence: "required" as const,
          };
    });
    return fields.some((field) => field === undefined)
      ? undefined
      : {
          storage: "project-object",
          fields: fields as readonly {
            readonly sourceKey: RustSourceMemberKey;
            readonly sourceName: string;
            readonly storageIndex: number;
            readonly carrier: TargetTypeRef;
            readonly presence: "required";
          }[],
        };
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural === undefined
    ? undefined
    : {
        storage: "object-handle",
        fields: structural.fields.map((field, storageIndex) => ({
          sourceKey: field.sourceKey,
          sourceName: field.sourceName,
          storageIndex,
          carrier: field.type,
          presence: field.presence,
          ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
          ...(field.method === true ? { method: true as const } : {}),
        })),
      };
}

export function selectRustRecordLiteralUnionVariantByCheckedType(
  walk: RustFactWalk,
  expression: Node,
  union: RustSourceUnion,
): RustSourceUnionVariant | undefined {
  const selectedSourceType = walk.context.semanticsFor(expression).types.expressionType(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const candidates = union.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function selectRustRecordLiteralUnionVariant(
  walk: RustFactWalk,
  expression: Node,
  union: RustSourceUnion,
  propertiesByName: ReadonlyMap<string, Node>,
): RustSourceUnionVariant | undefined {
  const propertyNames = [...propertiesByName.keys()].sort();
  let candidates = union.variants.filter((variant) =>
    variant.shape !== undefined &&
    variant.shape.fields.length === propertyNames.length &&
    variant.shape.fields.every((field, index) =>
      field.sourceName === propertyNames[index]));
  if (candidates.length === 0) {
    return undefined;
  }
  const semantics = walk.context.semanticsFor(expression);
  const selectedSourceType = semantics.types.expressionType(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const carrierCandidates = candidates.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  if (carrierCandidates.length === 1) {
    return carrierCandidates[0];
  }
  for (const [sourceName, property] of propertiesByName) {
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (initializer === undefined) {
      return undefined;
    }
    const fieldTypes = candidates.map((candidate) =>
      candidate.shape?.fields.find((field) => field.sourceName === sourceName)?.sourceType);
    if (fieldTypes.some((type) => type === undefined)) {
      return undefined;
    }
    const selectedFieldTypes = fieldTypes as readonly Type[];
    const firstFieldType = selectedFieldTypes[0]!;
    if (selectedFieldTypes.every((type) =>
      semantics.types.relationship(firstFieldType, type) !== "unrelated")) {
      continue;
    }
    const selectedValueType = semantics.types.expressionType(initializer);
    if (selectedValueType === undefined) {
      return undefined;
    }
    candidates = candidates.filter((_, index) => {
      const fieldType = selectedFieldTypes[index];
      if (fieldType === undefined) {
        return false;
      }
      const refinement = semantics.types.refinement(fieldType, selectedValueType);
      return refinement.kind === "exact" || refinement.kind === "members";
    });
    if (candidates.length < 2) {
      break;
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}
