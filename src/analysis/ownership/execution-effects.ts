import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  rustBindingProjectionFactKey,
  rustContextualValueConversionFactKey,
  rustFutureValueFactKey,
  rustResourceManagementFactKey,
  rustSourceAccessorEffectsFactKey,
  rustSourceCallEffectsFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import {
  rustTargetOperationIsFallible,
  type RustProjectFieldDispatchLookup,
  type RustStructuralStorageLookup,
} from "../facts/target-operation.js";
import { rustValueConversionIsFallible } from "../../target-model/conversions/contracts.js";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustResourceDisposalReceiverMode } from "../resources/management.js";

export interface RustOwnershipExecutionEffectInput {
  readonly ast: AstReader;
  readonly facts: RustPlanQueries;
  readonly structuralStorage: RustStructuralStorageLookup;
  readonly projectFieldDispatch: RustProjectFieldDispatchLookup;
}

export interface RustOwnershipResourceCleanupEffect {
  readonly access: "shared" | "mutable";
  readonly asynchronous: boolean;
  readonly fallible: boolean;
}

export function rustOwnershipNodeSuspensionKind(
  node: Node,
  input: RustOwnershipExecutionEffectInput,
): "await" | "yield" | undefined {
  const kind = input.ast.kindName(node);
  if (kind === "KindAwaitExpression") return "await";
  if (kind === "KindYieldExpression") return "yield";
  const operation = input.facts.getFact(node, rustTargetOperationFactKey);
  return operation?.kind === "iteration" && operation.iterationKind === "for-await-of"
    ? "await"
    : undefined;
}

export function rustOwnershipResourceCleanupEffect(
  declaration: Node,
  input: RustOwnershipExecutionEffectInput,
): RustOwnershipResourceCleanupEffect | undefined {
  const fact = input.facts.getFact(declaration, rustResourceManagementFactKey);
  if (fact === undefined) return undefined;
  const receiverMode = rustResourceDisposalReceiverMode(fact);
  if (receiverMode === undefined) return undefined;
  return Object.freeze({
    access: receiverMode === "mut-ref" ? "mutable" : "shared",
    asynchronous: fact.disposal.kind === "async",
    fallible: fact.disposal.fallible,
  });
}

export function rustOwnershipNodeMayThrow(
  node: Node,
  input: RustOwnershipExecutionEffectInput,
): boolean | undefined {
  if (input.ast.kindName(node) === "KindAwaitExpression") {
    const operand = Node_Expression(input.ast, node);
    const future = input.facts.getFact(operand, rustFutureValueFactKey);
    return operand === undefined || future === undefined
      ? undefined
      : future.awaiting === "fallible";
  }

  const operation = input.facts.getFact(node, rustTargetOperationFactKey);
  if (operation?.kind === "source-call") {
    const effects = input.facts.getFact(node, rustSourceCallEffectsFactKey);
    if (effects === undefined) return undefined;
    if (effects.invocation === "fallible") return true;
  }
  if (operation?.kind === "source-accessor") {
    const effects = input.facts.getFact(node, rustSourceAccessorEffectsFactKey);
    if (effects === undefined) return undefined;
    if ((operation.accessMode === "read" || operation.accessMode === "read-write") &&
      effects?.read === "fallible") {
      return true;
    }
    if ((operation.accessMode === "write" || operation.accessMode === "read-write") &&
      effects?.write === "fallible") {
      return true;
    }
  }
  if (rustTargetOperationIsFallible(
    operation,
    input.structuralStorage,
    input.projectFieldDispatch,
  )) {
    return true;
  }

  const projectionFact = input.facts.getFact(node, rustBindingProjectionFactKey);
  if (projectionFact !== undefined) {
    const projection = projectionFact.projection;
    if (projection.kind === "object-field") {
      if (projection.accessor !== undefined ||
        projection.storage === "object-handle" &&
          input.structuralStorage.field(
            projectionFact.sourceCarrier,
            projection.storageIndex,
          )?.storage === "property") {
        return true;
      }
    } else if (projection.kind === "object-rest" &&
      projection.fields.some((field) =>
        field.accessor !== undefined ||
        projection.storage === "object-handle" &&
          input.structuralStorage.field(
            projectionFact.sourceCarrier,
            field.sourceStorageIndex,
          )?.storage === "property")) {
      return true;
    }
  }

  return rustValueConversionIsFallible(
    input.facts.getFact(node, rustContextualValueConversionFactKey)?.conversion,
  );
}
