import { type AstReader, type Node } from "@tsonic/tsts";
import { asSourceNode, sourceEnclosingCallable, sourceNodeIdentity, sourceCallableValueParameters } from "@tsonic/target-api/source";
import { type RustProgramRecords } from "../../../target-model/records/program.js";
import { rustLifetimeKey, rustLifetimesEqual, type RustSourceGenericParameterContract, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { type RustTargetTypeResolutionContext } from "../../source-evidence/types/resolution/model.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";
import { rustParameterModeForCarriers } from "../../../policy/ownership/source-parameter-contracts.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";

export function rustSourceCallBorrowedReturn(
  expression: Node, ast: AstReader, records: RustProgramRecords,
): { readonly declaration: Node; readonly parameter: Node; readonly carrier: TargetTypeRef; readonly argument: Node } | undefined {
  const operation = records.targetOperation.get(expression);
  if (operation?.kind !== "source-call") return undefined;
  const selected = records.selectedCall.get(expression);
  const declaration = asSourceNode(selected?.sourceDeclaration, ast);
  const returned = declaration === undefined ? undefined : records.sourceCallableReturn.get(declaration)?.borrowedReturn;
  if (declaration === undefined || returned === undefined || selected === undefined) return undefined;
  const parameterIndex = selected.nativeParameterDeclarations.indexOf(returned.parameter);
  const parameter = parameterIndex < 0 ? undefined : operation.parameters[parameterIndex];
  const input = parameter?.inputs.length === 1 ? parameter.inputs[0] : undefined;
  const argument = input?.sourceForm === "value" && input.sourceParameterForm === "parameter" &&
    input.projection.kind === "direct" ? ast.arguments(expression)[input.sourceArgumentIndex] : undefined;
  const abi = records.sourceParameterAbi.get(returned.parameter);
  if (argument === undefined || parameter === undefined || abi === undefined) return undefined;
  const references = rustTargetGenericReferences(abi.valueCarrier);
  const bindings = inferRustTargetGenericBindings(abi.valueCarrier, parameter.valueCarrier, {
    typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
    constIdentities: new Set(references.constIdentities),
  });
  if (bindings === undefined) return undefined;
  const carrier = substituteRustTargetGenerics(returned.carrier, bindings.types, bindings.lifetimes, bindings.consts);
  if (carrier.kind !== "reference" || carrier.mutable || !rustTargetTypeRefEquals(carrier.referent, operation.resultCarrier)) return undefined;
  return Object.freeze({ declaration, parameter: returned.parameter, carrier, argument });
}

export function rustCallableImplicitLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  records: RustProgramRecords,
): readonly RustSourceGenericParameterContract[] {
  if (sourceEnclosingCallable(declaration, ast) !== declaration) return Object.freeze([]);
  const parameters = rustCallableInputLifetimeParameters(declaration, ast, records);
  const environment = records.retainedEnvironment.get(declaration);
  return environment === undefined ? parameters : Object.freeze([...parameters, Object.freeze({
    kind: "lifetime" as const, declaration, sourceName: environment.lifetime.name,
    lifetime: environment.lifetime, outlives: Object.freeze([]),
  })]);
}

export function rustCallableInputLifetimeParameters(
  declaration: Node,
  ast: AstReader,
  records: RustProgramRecords,
): readonly RustSourceGenericParameterContract[] {
  const retained = new Set<string>();
  const parameters = ast.is.IsClassDeclaration(declaration) || ast.is.IsClassExpression(declaration)
    ? [] : ast.parameters(declaration);
  return Object.freeze(parameters.flatMap(parameter => {
    const abi = parameter === undefined ? undefined : records.sourceParameterAbi.get(parameter);
    const lifetime = abi?.inputLifetime;
    if (parameter === undefined || lifetime === undefined || abi?.parameterCarrier.kind !== "reference" ||
      !rustLifetimesEqual(lifetime, abi.parameterCarrier.lifetime) ||
      rustParameterModeForCarriers(abi.valueCarrier, abi.parameterCarrier) !== abi.mode) return [];
    const identity = rustLifetimeKey(lifetime);
    if (retained.has(identity)) return [];
    retained.add(identity);
    return [Object.freeze({ kind: "lifetime" as const, declaration: parameter, sourceName: lifetime.name,
      lifetime, outlives: Object.freeze([]) })];
  }));
}







export function rustSourceInputLifetime(
  parameter: Node,
  context: RustTargetTypeResolutionContext,
): Extract<RustLifetimeRef, { readonly kind: "parameter" }> | undefined {
  const { ast } = context;
  const owner = ast.parent(parameter);
  if (!ast.is.IsParameterDeclaration(parameter) || owner === undefined) return undefined;
  const returned = context.sourceCallables.borrowedReturn(owner)?.parameter === parameter;
  if (!returned && (!ast.is.IsFunctionDeclaration(owner) ||
    !ast.hasModifierKind(owner, "async") && context.semanticsFor(owner).operations.generator(owner) === undefined)) return undefined;
  const identity = sourceNodeIdentity(ast, owner);
  if (identity === undefined || sourceCallableValueParameters(ast, owner, context.semanticsFor(owner))?.includes(parameter) !== true) return undefined;
  const names = new Set<string>();
  for (let enclosing: Node | undefined = owner; enclosing !== undefined; enclosing = ast.parent(enclosing)) {
    for (const selected of context.sourceLifetimes.contractFor(enclosing)?.parameters ?? [])
      if (selected.kind === "lifetime") names.add(selected.lifetime.name);
  }
  return Object.freeze({ kind: "parameter", identity: `source-input-borrow\0${identity}`,
    name: allocateRustGeneratedName(names, "input") });
}
