import type { Node, Type } from "@tsonic/tsts";
import type { RustOperationPolicyContext } from "../../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions } from "./model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { mapRustTargetTypes } from "../../../target-model/types/carriers/substitution.js";
import { rustTypeFamilyNormalizer } from "../../../policy/types/type-family-normalization.js";
import { resolveRustTypeFamilyApplication } from "../../../policy/types/resolution/type-families.js";
import { bindRustSourceGenericArguments } from "../../../policy/types/resolution/generic-arguments.js";
import type { RustTargetTypeResolutionContext } from "../../../policy/types/resolution/model.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/carriers/source-types.js";

export function bindRustSelectedReceiverContext(
  receiverType: Type | undefined,
  receiver: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): RustTargetTypeResolutionContext | undefined {
  const definition = options.projectTypes.definitionForCarrier(receiver);
  if (definition === undefined) return context;
  const own = context.sourceLifetimes.contractFor(definition.declaration)?.parameters ?? [];
  if (own.some(parameter => definition.genericParameters.filter(candidate =>
    candidate.declaration === parameter.declaration && candidate.kind === parameter.kind).length !== 1)) return undefined;
  if (definition.genericParameters.length === 0) return context;
  const arguments_ = rustSourceTypeCarrierValue(receiver)?.genericArguments;
  if (receiverType === undefined || arguments_ === undefined ||
    arguments_.length !== definition.genericParameters.length) return undefined;
  return bindRustSourceGenericArguments(definition.genericParameters, receiverType, arguments_, context);
}

export function instantiateRustSelectedMemberCarrier(
  declaration: Node,
  receiver: TargetTypeRef,
  receiverType: Type | undefined,
  declaredCarrier: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): TargetTypeRef | undefined {
  const result = options.projectTypes.instantiateMemberCarrier(declaration, receiver, declaredCarrier);
  if (result === undefined) return undefined;
  const familyRegistry = options.sourceTypes.typeFamilies;
  const definition = options.projectTypes.definitionContainingDeclaration(declaration);
  const bindings = receiverType === undefined ? [] : context.currentSemantics.types.typeArgumentBindings(receiverType) ?? [];
  const visit = (template: TargetTypeRef): boolean => {
    if (template.kind === "associated-type" && template.trait?.sourceItem !== undefined) {
      const selected = options.projectTypes.instantiateMemberCarrier(declaration, receiver, template);
      if (selected?.kind !== "associated-type") return selected !== undefined;
      const family = familyRegistry.get(template.trait.id);
      if (family?.kind !== "conditional") return false;
      if (familyRegistry.implementation(family.trait, selected.owner) === undefined) {
        const parameterName = template.owner.kind === "type-parameter" ? template.owner.identity : undefined;
        const parameter = parameterName === undefined ? undefined
          : definition?.genericParameters.find(candidate => candidate.kind === "type" && candidate.identity === parameterName);
        const sourceBindings = parameter === undefined ? [] : bindings.filter(binding => binding.declaration === parameter.declaration);
        const ownerDeclaration = options.sourceTypes.declarationForCarrier(selected.owner);
        const sourceArgument = sourceBindings.length === 1 ? sourceBindings[0]!.argumentType
          : selected.owner.kind === "type-parameter" && parameter !== undefined
            ? context.semanticsFor(parameter.declaration).declarations.declaredType(parameter.declaration)
            : ownerDeclaration === undefined ? undefined : context.semanticsFor(ownerDeclaration).declarations.declaredType(ownerDeclaration);
        const application = sourceArgument === undefined ? undefined
          : context.currentSemantics.types.instantiateAlias(family.declaration, [sourceArgument]);
        if (application === undefined || resolveRustTypeFamilyApplication(application, [selected.owner], context, options, new Set()) === undefined) return false;
      }
    }
    return rustTargetTypeChildren(template).every(visit);
  };
  return visit(declaredCarrier) ? mapRustTargetTypes(result, rustTypeFamilyNormalizer(familyRegistry)) : undefined;
}
