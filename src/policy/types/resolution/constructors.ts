import type { Signature, Type } from "@tsonic/tsts";
import type { RustSourceObjectShape } from "../source-type-registry.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustCallableEvidence } from "./source-evidence.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";

export function resolveRustConstructSignature(
  signature: Signature,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustSourceObjectShape["construction"] | undefined {
  const semantics = context.currentSemantics;
  const declaration = semantics.declarations.signatureDeclaration(signature);
  const result = semantics.types.returnType(signature);
  if (declaration === undefined || result === undefined || context.ast.typeParameters(declaration).length !== 0) return undefined;
  const typeNode = context.ast.typeNode(declaration);
  const carrier = resolveRustCallableEvidence({
    parameters: semantics.types.signatureParameterInfos(signature).map(parameter => ({
      ...parameter,
      omissionKind: parameter.parameterKind === "optional" ? "undefined" : parameter.parameterKind,
    })),
    result: { selectedType: result, declaration, ...(typeNode === undefined ? {} : { authoredTypeNode: typeNode }) },
  }, context, options, resolving);
  return carrier === undefined || rustCallableProtocol(carrier) === undefined ? undefined :
    Object.freeze({ declaration, signature, carrier });
}

export function resolveRustConstructType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustSourceObjectShape["construction"] | undefined {
  const signatures = context.currentSemantics.types.constructSignatures(type);
  return signatures.length === 1 ? resolveRustConstructSignature(signatures[0]!, context, options, resolving) : undefined;
}
