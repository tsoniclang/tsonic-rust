import { Node_Initializer, sourceCallableParameterEvidence } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { recordRustParameterAbiSelection } from "../declarations/types-and-bindings.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";
import { resolveRustSignatureParameterEvidence } from "../../policy/types/resolution/source-evidence.js";
import { resolveRustContextualParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustCallableProtocol, rustClosureProtocol, rustSourceOptionalTargetType } from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceParameterAbiFact } from "../../target-model/records/callables-and-resources.js";
import { selectRustClosedCallableContext, selectRustClosedCallableInputs } from "./contextual-inputs.js";

export function recordCallableParameterInputFacts(
  walk: RustFactWalk, declaration: Node, selectedSignature?: TargetTypeRef,
): readonly RustSourceParameterAbiFact[] | undefined {
  const { ast, records } = walk.context;
  records.assertOpen();
  const parameters = requireDenseSourceNodes(walk, ast.parameters(declaration),
    "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) return undefined;
  const existing = parameters.map(parameter => records.sourceParameterAbi.get(parameter));
  if (selectedSignature === undefined && existing.every(parameter => parameter !== undefined)) {
    return Object.freeze(existing as RustSourceParameterAbiFact[]);
  }
  let state = walk.callableSignatures.get(declaration);
  if (state?.inputActive) return undefined;
  if (state === undefined) {
    state = { active: false, inputActive: false, completed: new Map(), suspensions: new Map() };
    walk.callableSignatures.set(declaration, state);
  }
  state.inputActive = true;
  try {
    const semantics = walk.context.semanticsFor(declaration);
    const signature = semantics.types.declarationSignatureInfo(declaration);
    if (signature === undefined || semantics.declarations.signatureDeclaration(signature.signature) !== declaration ||
      signature.parameters.length !== parameters.length ||
      !signature.parameters.every((parameter, index) => parameter.declaration === parameters[index])) return undefined;
    const context = rustResolutionContext(walk, declaration);
    const declared = signature.parameters.map(parameter => resolveRustSignatureParameterEvidence(
      sourceCallableParameterEvidence(parameter, ast), context, walk.operationOptions, new Set()));
    if (declared.some(parameter => parameter === undefined)) return undefined;
    const logical = (rustCallableProtocol(selectedSignature) ?? rustClosureProtocol(selectedSignature))?.parameters ??
      declared as readonly TargetTypeRef[];
    if (logical.length !== parameters.length) return undefined;
    const selected = selectedSignature !== undefined || ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration)
      ? selectRustClosedCallableInputs(walk, declaration, logical) : logical;
    const abis = parameters.map((parameter, index) => {
      const input = selected[index]!;
      const parameterContext = rustResolutionContext(walk, parameter);
      return rustTargetTypeRefEquals(input, logical[index])
        ? walk.sourceCallableAbi.resolveParameterAbi(parameter, parameterContext, walk.operationOptions)
        : resolveRustContextualParameterAbi(parameter,
          Node_Initializer(ast, parameter) === undefined ? input : rustSourceOptionalTargetType(input),
          parameterContext, walk.operationOptions);
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
