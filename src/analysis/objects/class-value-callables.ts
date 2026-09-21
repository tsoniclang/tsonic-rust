import type { Node, Signature } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { rustResolutionContext } from "../program/walk.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustCallableProtocol, rustOptionElementCarrier, rustOptionTargetType } from "../../target-model/types/index.js";
import { rustProjectCallableTargetName } from "../facts/source-member-name.js";
import { resolveParameterAbi } from "../declarations/types-and-bindings.js";
import { selectRustCallableParameterAdapters, selectRustCallableValueAdapter } from "../callables/adapters.js";

export interface RustClassValueCallable {
  readonly declaration: Node;
  readonly ownerCarrier: TargetTypeRef;
  readonly targetName: string;
  readonly parameters: readonly RustCallableParameterAbi[];
  readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  readonly resultAdapter: RustCallableValueAdapter;
  readonly carrier: TargetTypeRef;
}

export function selectRustClassValueCallable(
  walk: RustFactWalk,
  classDeclaration: Node,
  sourceSignature: Signature,
  targetSignature: Signature,
  targetCarrier: TargetTypeRef,
  construction: boolean,
  semantics: SourceFileSemantics,
): RustClassValueCallable | undefined {
  const { ast, projectTypes } = walk.context;
  const owner = projectTypes.definitionForDeclaration(classDeclaration);
  const sourceDeclaration = semantics.declarations.signatureDeclaration(sourceSignature);
  const target = rustCallableProtocol(targetCarrier);
  if (owner === undefined || owner.kind !== "class" || owner.typeParameterNames.length !== 0 || target === undefined ||
    sourceDeclaration === undefined || ast.typeParameters(sourceDeclaration).length !== 0) return undefined;
  const matchingConstructors = construction ? projectTypes.constructorsForDefinition(owner)
    .filter(candidate => candidate.signature === sourceSignature || candidate.declaration === sourceDeclaration) : [];
  const sourceConstructor = matchingConstructors.length === 1 ? matchingConstructors[0] : undefined;
  if (construction && sourceConstructor === undefined || !construction && !ast.hasModifierKind(sourceDeclaration, "static")) return undefined;
  const implementation = construction ? undefined : walk.context.source.navigation.callableImplementation(sourceDeclaration);
  const declaration = construction ? sourceConstructor!.declaration ?? classDeclaration
    : implementation?.kind === "resolved" ? implementation.implementation.declaration : undefined;
  if (declaration === undefined) return undefined;
  const ownerCarrier = projectTypes.openCarrier(owner);
  const sourceParameters = construction ? sourceConstructor!.parameters.map(parameter => parameter.parameterDeclaration)
    : ast.parameters(declaration);
  const implementationParameters = sourceParameters.map(parameter => parameter === undefined ? undefined : resolveParameterAbi(walk, parameter));
  const selectedParameters = semantics.types.signatureParameterInfos(targetSignature);
  if (implementationParameters.some(parameter => parameter === undefined) || selectedParameters.length !== target.parameters.length) return undefined;
  const parameters = selectedParameters.map((parameter, index): RustCallableParameterAbi => ({
    form: parameter.parameterKind,
    valueCarrier: parameter.parameterKind === "optional" ? rustOptionElementCarrier(target.parameters[index]) ?? target.parameters[index]! : target.parameters[index]!,
    parameterCarrier: parameter.parameterKind === "optional" && rustOptionElementCarrier(target.parameters[index]) === undefined
      ? rustOptionTargetType(target.parameters[index]!) : target.parameters[index]!,
    mode: "value",
  }));
  const parameterAdapters = selectRustCallableParameterAdapters(parameters,
    implementationParameters as RustCallableParameterAbi[], projectTypes, walk.context.typeDefinitions);
  const resultSubject = ast.typeNode(declaration) ?? semantics.types.returnType(sourceSignature);
  const sourceResult = construction ? ownerCarrier : resultSubject === undefined ? undefined :
    resolveRustTargetTypeRef(resultSubject, rustResolutionContext(walk, declaration), walk.operationOptions);
  const resultAdapter = sourceResult === undefined ? undefined : selectRustCallableValueAdapter(sourceResult, target.result,
    projectTypes, walk.context.typeDefinitions);
  const targetName = construction ? sourceConstructor?.targetName : rustProjectCallableTargetName(declaration, walk.context);
  if (parameterAdapters === undefined || resultAdapter === undefined || targetName === undefined) return undefined;
  return Object.freeze({ declaration, ownerCarrier, targetName, parameters: Object.freeze(parameters),
    parameterAdapters: Object.freeze(parameterAdapters), resultAdapter, carrier: targetCarrier });
}
