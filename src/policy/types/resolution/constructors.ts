import type { TypeSignatureInfo, Type } from "@tsonic/tsts";
import { sourceCallableParameterEvidence } from "@tsonic/target-api/source";
import type { RustSourceObjectShape } from "../source-type-registry.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "./model.js";
import { resolveRustCallableEvidence } from "./source-evidence.js";
import { rustCallableProtocol } from "../../../target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { resolveRustTargetType } from "./target.js";

export function resolveRustConstructInstance(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
): TargetTypeRef | undefined {
  const semantics = context.currentSemantics;
  const signatures = semantics.types.signatureInfos(type, "construct");
  const results = signatures.map(signature => {
    const declaration = semantics.declarations.signatureDeclaration(signature.signature);
    const result = signature.returnType;
    return declaration === undefined || result === undefined || context.ast.typeParameters(declaration).length !== 0
      ? undefined : resolveRustTargetType(result, context, options, new Set());
  });
  const instance = results[0];
  return instance !== undefined && results.every(result => result !== undefined && rustTargetTypeRefEquals(result, instance))
    ? instance : undefined;
}

export function resolveRustConstructSignature(
  selected: TypeSignatureInfo,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustSourceObjectShape["construction"] | undefined {
  const semantics = context.currentSemantics;
  const signature = selected.signature;
  const declaration = semantics.declarations.signatureDeclaration(signature);
  const result = selected.returnType;
  if (declaration === undefined || result === undefined || context.ast.typeParameters(declaration).length !== 0) return undefined;
  const typeNode = context.ast.typeNode(declaration);
  const carrier = resolveRustCallableEvidence({
    parameters: selected.parameters.map(parameter => sourceCallableParameterEvidence(parameter, context.ast)),
    result: { selectedType: result, declaration, ...(typeNode === undefined ? {} : { authoredTypeNode: typeNode }) },
  }, context, options, resolving);
  return carrier === undefined || rustCallableProtocol(carrier) === undefined ? undefined :
    Object.freeze({ declaration, signatureInfo: selected, carrier });
}

export function resolveRustConstructType(
  type: Type,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  resolving: Set<object>,
): RustSourceObjectShape["construction"] | undefined {
  const signatures = context.currentSemantics.types.signatureInfos(type, "construct");
  return signatures.length === 1 ? resolveRustConstructSignature(signatures[0]!, context, options, resolving) : undefined;
}
