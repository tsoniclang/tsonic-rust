import {
  rustCallableTargetType,
  rustClosureTargetType,
  rustSourceTypeCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../../target-model/types/index.js";
import {
  Node_Type,
  sourcePresentCallableType,
} from "@tsonic/target-api/source";
import { requireDenseSourceNodes } from "../../source-evidence/dense-nodes.js";
import { resolveParameterAbi } from "../../callables/values/parameter-facts.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { resolveTypeNodeCarrier } from "../../source-evidence/types/source-carriers.js";

import { rustResolutionContext } from "../../program/walk.js";
import { rustSourceStorageSubjectContext } from "../../source-evidence/types/resolution/source-storage-projection.js";

import type { Node, Type } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../../program/walk.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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
    sourceCallableValueParameters(walk.context.ast, declaration, walk.context.semanticsFor(declaration)),
    "Project method property contains an undefined parameter slot.",
  );
  if (relationship?.kind !== "related" || parameters === undefined ||
    walk.context.ast.typeParameters(declaration).length !== 0 ||
    walk.context.ast.hasModifierKind(declaration, "async") ||
    walk.context.records.generator.get(declaration) !== undefined) {
    return undefined;
  }
  const parameterCarriers = parameters.map((parameter) => {
    const abi = walk.context.records.sourceParameterAbi.get(parameter);
    return abi?.form === "required" && abi.mode === "value"
      ? walk.context.projectTypes.instantiateMemberCarrier(
          parameter,
          relationship.targetType,
          abi.parameterCarrier,
        )
      : undefined;
  });
  const returnCarrier = walk.context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
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

export function resolveObjectLiteralMethodCarrier(
  walk: RustFactWalk,
  method: Node,
  selectedType: Type,
): TargetTypeRef | undefined {
  const typeParameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.typeParameters(method),
    "Authored object-literal method contains an undefined type-parameter slot.",
  );
  const parameters = requireDenseSourceNodes(
    walk,
    sourceCallableValueParameters(walk.context.ast, method, walk.context.semanticsFor(method)),
    "Authored object-literal method contains an undefined parameter slot.",
  );
  const authoredReturnType = Node_Type(walk.context.ast, method);
  if (typeParameters?.length === 0 && !walk.context.ast.hasModifierKind(method, "async") &&
    parameters !== undefined && authoredReturnType !== undefined &&
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
  return resolveRustTargetTypeRef(
    sourcePresentCallableType(selectedType, walk.context.semanticsFor(method)) ?? selectedType,
    rustSourceStorageSubjectContext(rustResolutionContext(walk, method), undefined),
    walk.operationOptions,
  );
}

interface RustResolvedRecordShape {
  readonly storage: "project-object" | "structural-object";
  readonly fields: readonly {
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
    const definition = walk.context.projectTypes.definitionForCarrier(carrier);
    const layout = definition === undefined ? undefined : walk.context.projectTypes.objectLayoutForDefinition(definition);
    if (layout === undefined || requireInterface && layout.kind !== "interface") {
      return undefined;
    }
    const fields = layout.fields.map((field) => {
      const declared = walk.context.records.runtimeCarrier.get(field.declaration)?.carrier ??
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
            sourceName: field.sourceName,
            storageIndex: field.storageIndex,
            carrier: instantiated,
            presence: field.presence,
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
            readonly presence: "required" | "optional";
          }[],
        };
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural === undefined
    ? undefined
    : {
        storage: "structural-object",
        fields: structural.fields.map((field, storageIndex) => ({
          sourceName: field.sourceName,
          storageIndex,
          carrier: field.type,
          presence: field.presence,
          ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
          ...(field.method === true ? { method: true as const } : {}),
        })),
      };
}
