import { sourceClosedCallableArguments } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { rustOperationContext } from "../program/walk.js";
import { rustCallableProtocol, rustClosureProtocol, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rebindRustCallableCarrier } from "../../policy/types/callables/method-values.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { selectedRustCheckedCallInputCarrier } from "../operations/members/calls/input-contract.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { selectRustParameterEntryConversion } from "../../policy/ownership/parameter-entry-conversion.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";

function checkedCallableInputs(walk: RustFactWalk, expression: Node): readonly {
  readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly carrier: TargetTypeRef;
}[] | undefined {
  const arguments_ = sourceClosedCallableArguments(expression, walk.context.source);
  if (arguments_ === undefined) return undefined;
  const contexts: { readonly parameters: readonly TargetTypeRef[]; readonly result: TargetTypeRef; readonly carrier: TargetTypeRef }[] = [];
  for (const argument of arguments_) {
    const semantics = walk.context.semanticsFor(argument.call);
    const checked = semantics.operations.call(argument.call);
    if (checked === undefined) return undefined;
    const selected = selectedRustCheckedCallInputCarrier(
      { source: checked, sourceSelectedDeclaration: semantics.declarations.signatureDeclaration(checked.selectedSignature) },
      argument.argumentIndex, rustOperationContext(walk, argument.call), walk.operationOptions,
    );
    const optional = rustOptionElementCarrier(selected);
    const selectedCallable = rustCallableProtocol(selected) ?? rustClosureProtocol(selected);
    const callableCarrier = selectedCallable === undefined ? optional : selected;
    const callable = selectedCallable ?? rustCallableProtocol(optional) ?? rustClosureProtocol(optional);
    if (callable === undefined || callableCarrier === undefined) return undefined;
    contexts.push({ ...callable, carrier: callableCarrier });
  }
  return contexts;
}

export function selectRustClosedCallableContext(
  walk: RustFactWalk,
  expression: Node,
  carrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const protocol = carrier?.kind === "function-pointer" ? { parameters: carrier.args, result: carrier.result }
    : rustCallableProtocol(carrier) ?? rustClosureProtocol(carrier);
  if (carrier === undefined || protocol === undefined) return carrier;
  const contexts = checkedCallableInputs(walk, expression);
  const selected = selectClosedCallableInputs(walk, expression, protocol.parameters, contexts);
  if (contexts === undefined || contexts.length === 0 || selected === undefined) return carrier;
  const { ast } = walk.context;
  const result = contexts[0]?.result;
  const topology = result === undefined ? undefined : rustAwaitSelection(result, walk.context.typeDefinitions);
  const contextualResult = ast.hasModifierKind(expression, "async") && ast.typeNode(expression) === undefined &&
    topology !== undefined && rustAwaitSelectionLeaves(topology).some(leaf => leaf.future !== undefined) &&
    contexts.every(context => rustTargetTypeRefEquals(context.result, result)) ? result! : protocol.result;
  const nativeContext = contexts[0]?.carrier;
  const nativeProtocol = rustCallableProtocol(nativeContext);
  const matchingContext = nativeProtocol?.error !== undefined && contexts.every(context =>
    rustTargetTypeRefEquals(rustCallableProtocol(context.carrier)?.error, nativeProtocol.error));
  return rebindRustCallableCarrier(matchingContext ? nativeContext! : carrier, selected, contextualResult);
}

export function selectRustClosedCallableInputs(
  walk: RustFactWalk,
  expression: Node,
  parameters: readonly (TargetTypeRef | undefined)[],
): readonly TargetTypeRef[] | undefined {
  const selected = selectClosedCallableInputs(walk, expression, parameters, checkedCallableInputs(walk, expression)) ?? parameters;
  return selected.every((carrier): carrier is TargetTypeRef => carrier !== undefined) ? selected : undefined;
}

function selectClosedCallableInputs(
  walk: RustFactWalk,
  expression: Node,
  logical: readonly (TargetTypeRef | undefined)[],
  contexts: ReturnType<typeof checkedCallableInputs>,
): readonly TargetTypeRef[] | undefined {
  const { ast } = walk.context;
  const parameters = sourceCallableValueParameters(ast, expression, walk.context.semanticsFor(expression));
  if (parameters === undefined || contexts === undefined || !isDenseDataArray(parameters)) return undefined;
  const broad = (parameters as readonly Node[]).map(parameter => {
    const syntax = ast.typeNode(parameter);
    const types = walk.context.semanticsFor(parameter).types;
    const type = syntax === undefined ? types.expressionType(parameter) : types.authoredType(syntax);
    return type !== undefined && (types.isUnknown(type) || types.isAny(type));
  });
  let inputs: readonly TargetTypeRef[] | undefined;
  for (const callable of contexts) {
    if (callable.parameters.length < parameters.length) return undefined;
    const current = callable.parameters.slice(0, parameters.length);
    if (current.some(type => !concrete(type)) ||
      inputs !== undefined && !current.every((type, index) => rustTargetTypeRefEquals(type, inputs![index]))) return undefined;
    inputs = current;
  }
  if (inputs === undefined) return undefined;
  const selected = logical.map((type, index) => {
    const input = inputs[index];
    if (input === undefined || rustTargetTypeRefEquals(input, type)) return type;
    if (broad[index]) return input;
    if (type === undefined) return undefined;
    return selectRustParameterEntryConversion(input, type, walk.context.typeDefinitions) === undefined ? undefined : input;
  });
  return selected.some(type => type === undefined) ? undefined : selected as readonly TargetTypeRef[];
}

function concrete(type: TargetTypeRef): boolean {
  let resolved = true;
  mapRustTargetTypes(type, part => {
    if (part.kind === "opaque" || part.kind === "type-parameter" || part.kind === "associated-type") resolved = false;
    return part;
  });
  return resolved;
}
