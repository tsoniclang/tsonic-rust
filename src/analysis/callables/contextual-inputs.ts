import { sourceClosedCallableArguments } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { rustCallableProtocol, rustCallableTargetType, rustClosureProtocol, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectedRustCheckedCallInputCarrier } from "../operations/provider/calls/input-contract.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";

export function selectRustClosedCallableInputs(
  walk: RustFactWalk,
  expression: Node,
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const protocol = rustCallableProtocol(carrier);
  if (protocol === undefined) return carrier;
  const { ast } = walk.context;
  const parameters = ast.parameters(expression);
  if (!isDenseDataArray(parameters) || parameters.some(parameter => parameter === undefined)) return carrier;
  const broad = (parameters as readonly Node[]).map(parameter => {
    const syntax = ast.typeNode(parameter);
    const types = walk.context.semanticsFor(parameter).types;
    const type = syntax === undefined ? types.expressionType(parameter) : types.authoredType(syntax);
    return type !== undefined && (types.isUnknown(type) || types.isAny(type));
  });
  const arguments_ = sourceClosedCallableArguments(expression, walk.context.source);
  if (arguments_ === undefined) return carrier;
  let inputs: readonly TargetTypeRef[] | undefined;
  for (const argument of arguments_) {
    const semantics = walk.context.semanticsFor(argument.call);
    const checked = semantics.operations.call(argument.call);
    if (checked === undefined) return carrier;
    const selected = selectedRustCheckedCallInputCarrier(
      { source: checked, sourceSelectedDeclaration: semantics.declarations.signatureDeclaration(checked.selectedSignature) },
      argument.argumentIndex, rustOperationContext(walk, argument.call), walk.operationOptions,
    );
    const optional = rustOptionElementCarrier(selected);
    const callable = rustCallableProtocol(selected) ?? rustClosureProtocol(selected) ??
      rustCallableProtocol(optional) ?? rustClosureProtocol(optional);
    if (callable === undefined || callable.parameters.length < parameters.length) return carrier;
    const current = callable.parameters.slice(0, parameters.length);
    if (current.some(type => !concrete(type)) ||
      inputs !== undefined && !current.every((type, index) => rustTargetTypeRefEquals(type, inputs![index]))) return carrier;
    inputs = current;
  }
  if (inputs === undefined) return carrier;
  const selected = protocol.parameters.map((type, index) => {
    const input = inputs[index];
    if (input === undefined || rustTargetTypeRefEquals(input, type)) return type;
    if (broad[index]) return input;
    const conversion = selectRustSourceValueConversion(input, type, walk.context.typeDefinitions);
    const contract = conversion === undefined ? undefined
      : rustValueConversionContract(conversion, walk.context.typeDefinitions);
    return contract?.category === "exact" && contract.sourceMode === "value" && !contract.fallible ? input : undefined;
  });
  return selected.some(type => type === undefined) ? carrier
    : rustCallableTargetType(selected as readonly TargetTypeRef[], protocol.result);
}

function concrete(type: TargetTypeRef): boolean {
  let resolved = true;
  mapRustTargetTypes(type, part => {
    if (part.kind === "opaque" || part.kind === "type-parameter" || part.kind === "associated-type") resolved = false;
    return part;
  });
  return resolved;
}
