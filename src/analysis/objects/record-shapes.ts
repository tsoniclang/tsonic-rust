import {
  rustCallableTargetType,
  rustClosureTargetType,
  rustSourceTypeCarrierValue,
  rustStructuralObjectCarrierValue,
} from "../../target-model/types/index.js";
import {
  Node_Type,
  sourcePresentCallableType,
} from "@tsonic/target-api/source";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveParameterAbi } from "../declarations/types-and-bindings.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { resolveTypeNodeCarrier } from "../declarations/types-and-bindings.js";
import { rustGeneratorFactKey, rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey } from "../facts/keys.js";
import { rustProjectObjectLayout } from "../project-types/object-layout.js";
import { rustResolutionContext } from "../program/walk.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import type { Node, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

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
  const selected = resolveRustTargetTypeRef(
    sourcePresentCallableType(selectedType, walk.context.semanticsFor(method)) ?? selectedType,
    rustResolutionContext(walk, method),
    walk.operationOptions,
  );
  if (selected !== undefined) {
    return selected;
  }
  return resolveRustTargetTypeRef(
    implementationType,
    rustResolutionContext(walk, method),
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
