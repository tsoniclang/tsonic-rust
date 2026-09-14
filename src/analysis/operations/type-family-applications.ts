import type { Node, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import { rustResolutionContext } from "../program/walk.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/carriers/substitution.js";
import type { RustSelectedTargetSignature, RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { resolveRustTypeFamilyApplication } from "../../policy/types/resolution/type-families.js";

export function realizeRustSelectedTypeFamilies(
  walk: RustFactWalk,
  node: Node,
  signature: RustSelectedTargetSignature,
  targetArguments: readonly RustTargetGenericArgument[],
): boolean {
  const parameters = signature.member.genericParameters ?? [];
  const sourceArguments = signature.sourceSelectedMethodTypeArguments ?? [];
  if (parameters.length !== targetArguments.length || parameters.length !== sourceArguments.length) return false;
  const types = new Map<string, Type>();
  const carriers = new Map<string, TargetTypeRef>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = targetArguments[index];
    if (parameter.kind !== "type" || argument?.kind !== "type") continue;
    types.set(parameter.sourceName, sourceArguments[index]!.selectedType);
    carriers.set(parameter.sourceName, argument.type);
  }
  const visit = (carrier: TargetTypeRef): boolean => {
    if (carrier.kind === "associated-type" && carrier.trait?.sourceItem !== undefined) {
      const family = walk.context.typeFamilies.get(carrier.trait.id);
      const owner = substituteRustTargetTypeParameters(carrier.owner, carriers);
      if (family !== undefined && walk.context.typeFamilies.implementation(family.trait.id, owner) !== undefined) {
        return rustTargetTypeChildren(carrier).every(visit);
      }
      const declaration = walk.sourceTypes.declarationForCarrier(owner);
      const type = carrier.owner.kind === "type-parameter" ? types.get(carrier.owner.name)
        : declaration === undefined ? undefined : walk.context.semanticsFor(declaration).declarations.declaredType(declaration);
      if (family === undefined || type === undefined) return false;
      const application = walk.context.semanticsFor(node).types.instantiateAlias(family.declaration, [type]);
      if (application === undefined || resolveRustTypeFamilyApplication(application, [owner],
        rustResolutionContext(walk, node), walk.operationOptions, new Set()) === undefined) return false;
    }
    return rustTargetTypeChildren(carrier).every(visit);
  };
  return signature.member.parameters.every(parameter => visit(parameter.type)) &&
    (signature.member.returnType === undefined || visit(signature.member.returnType));
}
