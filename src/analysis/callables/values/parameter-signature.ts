import { Node_Initializer, sourceCallableValueParameters } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../../program/walk.js";
import { rustResolutionContext } from "../../program/walk.js";
import { recordRustParameterAbiSelection, refuseRustParameterCarrier } from "./parameter-facts.js";
import { requireDenseSourceNodes } from "../../source-evidence/dense-nodes.js";
import { resolveRustTargetTypeRef } from "../../source-evidence/types/resolution/source.js";
import { resolveRustContextualParameterAbi } from "../calls/source-callable-abi.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustCallableProtocol, rustClosureProtocol, rustSourceOptionalTargetType } from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSourceParameterAbiFact } from "../../../target-model/records/callables/callables-and-resources.js";
import { selectRustClosedCallableContext, selectRustClosedCallableInputs } from "../../expected-types/callable-contexts.js";

export function recordCallableParameterInputFacts(
  walk: RustFactWalk, declaration: Node, selectedSignature?: TargetTypeRef,
): readonly RustSourceParameterAbiFact[] | undefined {
  const { ast, records } = walk.context;
  records.assertOpen();
  let state = walk.callableSignatures.get(declaration);
  if (state?.inputActive) return undefined;
  const parameters = requireDenseSourceNodes(walk,
    sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration)),
    "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) return undefined;
  const existing = parameters.map(parameter => records.sourceParameterAbi.get(parameter));
  if (selectedSignature === undefined && existing.every(parameter => parameter !== undefined)) {
    return Object.freeze(existing as RustSourceParameterAbiFact[]);
  }
  if (state === undefined) {
    state = { active: false, inputActive: false, completed: new Map(), suspensions: new Map() };
    walk.callableSignatures.set(declaration, state);
  }
  state.inputActive = true;
  try {
    const selections = parameters.map(parameter => walk.sourceCallableAbi.resolveParameterAbi(
      parameter, rustResolutionContext(walk, parameter), walk.operationOptions));
    for (const [index, selection] of selections.entries()) {
      if (selection?.kind === "rejected") refuseRustParameterCarrier(walk, parameters[index]!, selection.reason);
    }
    const declared = selections.map(selection => selection?.kind === "resolved" ? selection.abi : undefined);
    if (declared.some(parameter => parameter === undefined)) return undefined;
    const logical = (rustCallableProtocol(selectedSignature) ?? rustClosureProtocol(selectedSignature))?.parameters ??
      declared.map(abi => abi!.form === "default" ? abi!.parameterCarrier : abi!.valueCarrier);
    const selected = selectedSignature !== undefined || ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration)
      ? selectRustClosedCallableInputs(walk, declaration, logical) : logical;
    const abis = parameters.map((parameter, index) => {
      const input = selected[index]!;
      const parameterContext = rustResolutionContext(walk, parameter);
      if (rustTargetTypeRefEquals(input, logical[index])) return declared[index];
      const contextual = resolveRustContextualParameterAbi(parameter,
        Node_Initializer(ast, parameter) === undefined ? input : rustSourceOptionalTargetType(input),
        parameterContext, walk.operationOptions);
      if (contextual?.kind === "rejected") {
        refuseRustParameterCarrier(walk, parameter, contextual.reason);
        return undefined;
      }
      return contextual?.abi;
    });
    if (abis.some(abi => abi === undefined)) return undefined;
    for (const [index, parameter] of parameters.entries()) {
      if (!recordRustParameterAbiSelection(walk, parameter, abis[index]!)) return undefined;
    }
    const admitted = parameters.map(parameter => records.sourceParameterAbi.get(parameter));
    return admitted.some(parameter => parameter === undefined) ? undefined
      : Object.freeze(admitted as RustSourceParameterAbiFact[]);
  } finally {
    state.inputActive = false;
  }
}

export function recordCallableParameterSignatureFacts(
  walk: RustFactWalk, declaration: Node, selectedSignature?: TargetTypeRef,
): TargetTypeRef | undefined {
  if (recordCallableParameterInputFacts(walk, declaration, selectedSignature) === undefined) return undefined;
  const signature = selectedSignature ?? (walk.context.ast.is.IsArrowFunction(declaration) || walk.context.ast.is.IsFunctionExpression(declaration)
    ? resolveRustTargetTypeRef(declaration,
        { ...rustResolutionContext(walk, declaration), callableRepresentation: "signature" }, walk.operationOptions)
    : undefined);
  const contextual = selectRustClosedCallableContext(walk, declaration, signature);
  return contextual;
}
