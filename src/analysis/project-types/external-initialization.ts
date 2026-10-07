import type { AstReader, Node } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustExternalProjectBase } from "../../target-model/types/external-project-types.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustOptionElementCarrier, rustStringTargetType } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { validateRustFinalizedOperationAbi, type RustFinalizedSourceInput } from "../facts/finalized-operation-abi.js";
import { sourceInput } from "../facts/finalized-operation/conversions.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustValueCarrierTransitionTarget } from "../facts/value-carrier-queries.js";
import { rustFinalizedCarrierTransitionMatches } from "../facts/target-operation.js";

export type RustExternalInitialization =
  | { readonly kind: "empty" }
  | { readonly kind: "value" | "optional"; readonly input: RustFinalizedSourceInput };

export function selectRustExternalInitialization(
  base: RustExternalProjectBase,
  call: Node,
  ast: AstReader,
  facts: RustPlanQueries,
  definitions: RustTypeDefinitions,
): RustExternalInitialization | undefined {
  const operation = facts.getFact(call, rustTargetOperationFactKey);
  const fields = base.fields.filter(field => field.initializer.kind === "message");
  if (fields.length !== 1 || fields[0]!.initializer.kind !== "message" ||
    fields[0]!.initializer.parameterIndex !== 0 || !rustTargetTypeRefEquals(fields[0]!.carrier, rustStringTargetType()) ||
    operation?.kind !== "provider-operation" || operation.operationId !== base.constructorOperationId ||
    operation.abi.operationKind !== "constructor" || !validateRustFinalizedOperationAbi(operation.abi, definitions) ||
    operation.abi.target.form !== "call" || operation.abi.target.path !== base.constructorPath ||
    operation.abi.targetArguments.length !== 1 || !rustTargetTypeRefEquals(operation.resultCarrier, base.targetType)) return undefined;
  const arguments_ = ast.arguments(call);
  if (arguments_.length !== operation.abi.sourceArguments.length || arguments_.length > 1) return undefined;
  if (arguments_.length === 0) return Object.freeze({ kind: "empty" });
  const argument = arguments_[0];
  const carrier = argument === undefined ? undefined : facts.getRuntimeCarrierFact(argument)?.carrier;
  const selected = operation.abi.sourceArguments[0];
  if (carrier === undefined || selected?.form !== "value" ||
    !rustFinalizedCarrierTransitionMatches(carrier, rustValueCarrierTransitionTarget(facts, argument, carrier), selected.carrier)) return undefined;
  const kind = rustTargetTypeRefEquals(selected.carrier, rustStringTargetType()) ? "value"
    : rustTargetTypeRefEquals(rustOptionElementCarrier(selected.carrier), rustStringTargetType()) ? "optional" : undefined;
  const input = kind === undefined ? undefined : sourceInput({ kind: "argument", sourceIndex: 0 }, selected.carrier, "value", undefined, definitions);
  return kind === undefined || input === undefined ? undefined : snapshotClosedMetadata({ kind, input });
}
