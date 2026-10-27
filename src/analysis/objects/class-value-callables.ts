import type { Node, TypeSignatureInfo } from "@tsonic/tsts";
import { sourceCallableValueParameters, type SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustCallableParameterAbi, RustCallableValueAdapter } from "../../target-model/records/callables/callable-adapters.js";
import type { RustClassValueCallable } from "../../target-model/records/callables/class-value-callables.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { rustCallableProtocol, rustOptionElementCarrier, rustSourceOptionalTargetType } from "../../target-model/types/index.js";
import { rustProjectCallableTargetName } from "../names/source-member-name.js";
import { resolveParameterAbi } from "../callables/values/parameter-facts.js";
import { projectOwnerTypeSubstitutions, substituteRustCallableParameterAbi } from "../callables/native/adapters.js";
import { selectRustCallableParameterAdapters, selectRustCallableValueAdapter } from "../../policy/conversions/callable-adapters.js";
import { substituteRustTargetTypeParameters } from "../../target-model/types/index.js";

export interface RustClassValueCallablePlan extends Omit<RustClassValueCallable, "resultAdapter"> {
  readonly resultCarrier: TargetTypeRef;
}

export function selectRustClassValueCallable(
  walk: RustFactWalk,
  classDeclaration: Node,
  source: TypeSignatureInfo,
  destination: TypeSignatureInfo,
  targetCarrier: TargetTypeRef,
  semantics: SourceFileSemantics,
  instance = false,
  selectedOwnerCarrier?: TargetTypeRef,
): RustClassValueCallable | undefined {
  const plan = selectRustClassValueCallablePlan(walk, classDeclaration, source, destination, targetCarrier,
    false, semantics, instance, selectedOwnerCarrier);
  const target = rustCallableProtocol(targetCarrier);
  const adapter = plan === undefined || target === undefined ? undefined
    : selectRustCallableValueAdapter(plan.resultCarrier, target.result, walk.context.projectTypes, walk.context.typeDefinitions);
  return plan === undefined || adapter === undefined ? undefined : finalizeRustClassValueCallable(plan, adapter);
}

export function finalizeRustClassValueCallable(
  plan: RustClassValueCallablePlan,
  resultAdapter: RustCallableValueAdapter,
): RustClassValueCallable {
  const { resultCarrier, ...callable } = plan;
  return Object.freeze({ ...callable, resultAdapter });
}

export function selectRustClassValueCallablePlan(
  walk: RustFactWalk,
  classDeclaration: Node,
  source: TypeSignatureInfo,
  destination: TypeSignatureInfo,
  targetCarrier: TargetTypeRef,
  construction: boolean,
  semantics: SourceFileSemantics,
  instance = false,
  selectedOwnerCarrier?: TargetTypeRef,
): RustClassValueCallablePlan | undefined {
  const { ast, projectTypes } = walk.context;
  const sourceSignature = source.signature;
  const owner = projectTypes.definitionForDeclaration(classDeclaration);
  const sourceDeclaration = semantics.declarations.signatureDeclaration(sourceSignature);
  const target = rustCallableProtocol(targetCarrier);
  if (owner === undefined || owner.kind !== "class" || target === undefined ||
    !construction && (sourceDeclaration === undefined || ast.typeParameters(sourceDeclaration).length !== 0)) return undefined;
  const matchingConstructors = construction ? projectTypes.constructorsForDefinition(owner)
    .filter(candidate => candidate.signature === sourceSignature || sourceDeclaration !== undefined && candidate.declaration === sourceDeclaration) : [];
  const sourceConstructor = matchingConstructors.length === 1 ? matchingConstructors[0] : undefined;
  if (construction && sourceConstructor === undefined || !construction && ast.hasModifierKind(sourceDeclaration!, "static") === instance) return undefined;
  const implementation = construction ? undefined : walk.context.source.navigation.callableImplementation(sourceDeclaration!);
  const declaration = construction ? sourceConstructor!.declaration ?? classDeclaration
    : implementation?.kind === "resolved" ? implementation.implementation.declaration : undefined;
  if (declaration === undefined) return undefined;
  const ownerCarrier = selectedOwnerCarrier ?? projectTypes.openCarrier(owner);
  const substitutions = projectOwnerTypeSubstitutions(owner, ownerCarrier);
  const selectedSourceParameters = sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration),
    { kind: "selected-invocation", signature: sourceSignature });
  const implementationSourceParameters = construction ? sourceConstructor!.parameters.map(parameter => parameter.parameterDeclaration)
    : sourceCallableValueParameters(ast, declaration, walk.context.semanticsFor(declaration), { kind: "declaration" });
  if (selectedSourceParameters === undefined || implementationSourceParameters === undefined) return undefined;
  const implementationParameters = implementationSourceParameters.map(parameter => {
    const abi = parameter === undefined ? undefined : resolveParameterAbi(walk, parameter);
    return abi === undefined ? undefined : substituteRustCallableParameterAbi(abi, substitutions);
  });
  const selectedParameters = destination.parameters;
  if (implementationParameters.some(parameter => parameter === undefined) || selectedParameters.length !== target.parameters.length) return undefined;
  const parameters = selectedParameters.map((parameter, index): RustCallableParameterAbi => ({
    form: parameter.parameterKind,
    valueCarrier: parameter.parameterKind === "optional" ? rustOptionElementCarrier(target.parameters[index]) ?? target.parameters[index]! : target.parameters[index]!,
    parameterCarrier: parameter.parameterKind === "optional" && rustOptionElementCarrier(target.parameters[index]) === undefined
      ? rustSourceOptionalTargetType(target.parameters[index]!) : target.parameters[index]!,
    mode: "value",
  }));
  const parameterAdapters = selectRustCallableParameterAdapters(parameters,
    implementationParameters as RustCallableParameterAbi[], projectTypes, walk.context.typeDefinitions);
  const resultSubject = ast.typeNode(declaration) ?? source.returnType;
  const declaredResult = construction ? ownerCarrier : resultSubject === undefined ? undefined :
    resolveRustTargetTypeRef(resultSubject, rustResolutionContext(walk, declaration), walk.operationOptions);
  const sourceResult = declaredResult === undefined ? undefined : substituteRustTargetTypeParameters(declaredResult, substitutions);
  const targetName = construction ? sourceConstructor?.targetName : rustProjectCallableTargetName(declaration, walk.context);
  if (parameterAdapters === undefined || sourceResult === undefined || targetName === undefined) return undefined;
  return Object.freeze({ declaration, ownerCarrier, targetName, parameters: Object.freeze(parameters),
    parameterAdapters: Object.freeze(parameterAdapters), resultCarrier: sourceResult, carrier: targetCarrier });
}
