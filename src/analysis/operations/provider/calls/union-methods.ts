import type { Node } from "@tsonic/tsts";
import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../../../policy/operations/contracts.js";
import { resolveRustTargetTypeRef } from "../../../../policy/types/resolution.js";
import { selectRustPointerReturnCarrier } from "../../../../policy/operations/pointer-return.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustOptionElementCarrier, rustSourceUnionCarrierValue } from "../../../../target-model/types/index.js";
import type { RustSelectedUnionMethod, RustSelectedUnionMethodIdentity, RustTargetMember, TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustProjectCallableTargetName } from "../../../facts/source-member-name.js";
import type { RustOperationsProviderOptions } from "../model.js";
import { selectedCallCalleeSymbol } from "../operators.js";

export function selectRustUnionMethods(
  request: RustCheckedCallSelectionInput,
  receiver: TargetTypeRef | undefined,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): readonly RustSelectedUnionMethodIdentity[] | undefined {
  const value = rustSourceUnionCarrierValue(receiver);
  if (receiver === undefined || value?.origin !== "generated") return undefined;
  const union = options.sourceTypes.sourceUnionForCarrier(receiver);
  const symbol = selectedCallCalleeSymbol(request);
  if (union === undefined || symbol === undefined) return undefined;
  const declarations = [...new Set([
    ...context.currentSemantics.declarations.symbolDeclarations(symbol),
    ...(options.sourceTypes.declarationsForSelectedSymbol(symbol) ?? []),
  ])];
  const variants = union.variants.map(variant => {
    const candidates = declarations.filter(declaration => {
      const owner = options.projectTypes.definitionContainingDeclaration(declaration);
      return context.ast.kindName(declaration) === "KindMethodDeclaration" &&
        !context.ast.hasModifierKind(declaration, "static") && context.ast.typeParameters(declaration).length === 0 &&
        owner !== undefined && options.projectTypes.relationship(variant.carrier, owner).kind === "related";
    });
    if (candidates.length !== 1) return undefined;
    const selected = candidates[0]!;
    const implementation = context.source.navigation.callableImplementation(selected);
    const targetName = rustProjectCallableTargetName(selected, context);
    if (implementation.kind !== "resolved" || targetName === undefined) return undefined;
    return { name: variant.name, carrier: variant.carrier, declaration: implementation.implementation.declaration, targetName };
  });
  return variants.some(variant => variant === undefined) ? undefined : Object.freeze(variants as RustSelectedUnionMethodIdentity[]);
}

export function resolveRustUnionMethodContracts(
  methods: readonly RustSelectedUnionMethodIdentity[],
  parameters: readonly RustTargetMember["parameters"][number][],
  result: TargetTypeRef,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): { readonly result: TargetTypeRef; readonly methods: readonly RustSelectedUnionMethod[] } | undefined {
  const resolved = methods.map(method => {
    const declarations = context.ast.parameters(method.declaration);
    if (declarations.length !== parameters.length || context.ast.hasModifierKind(method.declaration, "async")) return undefined;
    const valid = declarations.every((declaration, index) => {
      if (declaration === undefined) return false;
      const abi = options.sourceCallableAbi.resolveParameterAbi(declaration, context, options);
      const parameter = parameters[index]!;
      return abi?.form === "required" &&
        parameter.passingMode === (abi.mode === "mut-ref" ? "borrow-mut" : abi.mode === "ref" ? "borrow-shared" : "by-value") &&
        rustTargetTypeRefEquals(parameter.type, options.projectTypes.instantiateMemberCarrier(declaration, method.carrier, abi.parameterCarrier));
    });
    const annotation = context.ast.typeNode(method.declaration);
    const returnType = selectRustPointerReturnCarrier(method.declaration, context, options) ??
      (annotation === undefined ? undefined : resolveRustTargetTypeRef(annotation, context, options));
    const instantiated = returnType === undefined ? undefined : options.projectTypes.instantiateMemberCarrier(method.declaration, method.carrier, returnType);
    return !valid || instantiated === undefined ? undefined : { ...method, returnType: instantiated };
  });
  if (resolved.some(method => method === undefined)) return undefined;
  const returns = resolved.map(method => method!.returnType);
  const common = returns.find(type => rustOptionElementCarrier(type) !== undefined) ?? result;
  const element = rustOptionElementCarrier(common);
  if (returns.some(type => !rustTargetTypeRefEquals(type, common) &&
    (element === undefined || !rustTargetTypeRefEquals(type, element)))) return undefined;
  return Object.freeze({ result: common, methods: Object.freeze(resolved.map(method => Object.freeze({
    ...method!, resultConversion: rustTargetTypeRefEquals(method!.returnType, common)
      ? undefined : { kind: "option-some" as const, element: element! },
  }))) });
}

export function rustUnionMethodOwner(
  methods: readonly RustSelectedUnionMethodIdentity[],
  declaration: Node,
): TargetTypeRef | undefined {
  const matches = methods.filter(method => method.declaration === declaration);
  return matches.length === 1 ? matches[0]!.carrier : undefined;
}
