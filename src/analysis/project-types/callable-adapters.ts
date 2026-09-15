import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import type { RustProjectTypeDefinition } from "./type-policy.js";
import type { RustProjectMethodDispatchVariant } from "./method-dispatch.js";
import type { RustProjectCallableAdapter } from "../facts/project-callable-adapters.js";
import { rustProjectCallableAdaptersKey } from "../facts/project-callable-adapters.js";
import {
  projectOwnerTypeSubstitutions,
  sourceCallableParameterAbis,
  sourceCallableReturnCarrier,
  selectRustCallableParameterAdapters,
  selectRustCallableValueAdapter,
  rustCallableParameterAdapterIsFallible,
  rustCallableValueAdapterIsFallible,
} from "../callables/adapters.js";

export function recordRustProjectCallableAdapterFacts(walk: RustFactWalk): void {
  const { ast, projectTypes } = walk.context;
  for (const concrete of projectTypes.definitions) {
    if (concrete.kind !== "class" || !projectTypes.isPolymorphic(concrete)) continue;
    const lineage = projectTypes.classLineage(concrete);
    const interfaces = projectTypes.interfacesForClass(concrete);
    if (lineage === undefined || interfaces === undefined) continue;
    const receiver = projectTypes.openCarrier(concrete);
    const adapters: RustProjectCallableAdapter[] = [];
    for (const owner of [...lineage, ...interfaces]) {
      const members = ast.members(owner.declaration);
      if (!isDenseDataArray(members) || members.some(member => member === undefined)) {
        reject(walk, owner.declaration, "Project dispatch requires a dense member inventory.");
        continue;
      }
      for (const member of members as readonly Node[]) {
        if (ast.hasModifierKind(member, "static")) continue;
        const kind = ast.kindName(member);
        if (kind !== "KindMethodDeclaration" && kind !== "KindMethodSignature" &&
          kind !== "KindGetAccessor" && kind !== "KindSetAccessor") continue;
        const selected = projectTypes.memberImplementation(concrete, member);
        if (selected.kind !== "resolved") continue;
        const implementation = selected.implementation.declaration;
        if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
          const slot = projectTypes.memberSlotName(member, kind === "KindGetAccessor" ? "read" : "write");
          if (slot !== undefined) record(member, implementation, slot);
        } else {
          for (const variant of walk.context.projectMethodDispatch.variantsForMember(member)) {
            record(member, implementation, variant.virtualSlot, variant);
            if (owner.kind === "class" && !ast.hasModifierKind(member, "abstract")) {
              record(member, member, variant.exactSlot, variant);
            }
          }
        }
      }
    }
    walk.context.facts.set(concrete.declaration, rustProjectCallableAdaptersKey, Object.freeze(adapters));

    function record(contract: Node, implementation: Node, slot: string, variant?: RustProjectMethodDispatchVariant): void {
      const adapter = classifyAdapter(walk, receiver, contract, implementation, slot, variant);
      if (adapter === undefined) {
        reject(walk, implementation, "The selected project override has no exact native parameter/result adapter.");
      } else {
        adapters.push(adapter);
      }
    }
  }
}

function classifyAdapter(
  walk: RustFactWalk,
  receiver: TargetTypeRef,
  contract: Node,
  implementation: Node,
  slot: string,
  variant: RustProjectMethodDispatchVariant | undefined,
): RustProjectCallableAdapter | undefined {
  const { ast, projectTypes, facts } = walk.context;
  const contractOwner = projectTypes.definitionContainingDeclaration(contract);
  const implementationOwner = projectTypes.definitionContainingDeclaration(implementation);
  if (contractOwner === undefined || implementationOwner === undefined) return undefined;
  const contractSubstitutions = substitutions(contractOwner, contract);
  const implementationSubstitutions = substitutions(implementationOwner, implementation);
  if (contractSubstitutions === undefined || implementationSubstitutions === undefined) return undefined;
  const input = { ast, facts };
  const parameters = sourceCallableParameterAbis(input, contract, contractSubstitutions);
  const implementationParameters = sourceCallableParameterAbis(input, implementation, implementationSubstitutions);
  const returnCarrier = sourceCallableReturnCarrier(input, contract, contractSubstitutions);
  const implementationReturnCarrier = sourceCallableReturnCarrier(input, implementation, implementationSubstitutions);
  if (parameters === undefined || implementationParameters === undefined ||
    returnCarrier === undefined || implementationReturnCarrier === undefined) return undefined;
  const parameterAdapters = selectRustCallableParameterAdapters(parameters, implementationParameters, projectTypes);
  const resultAdapter = selectRustCallableValueAdapter(implementationReturnCarrier, returnCarrier, projectTypes);
  if (parameterAdapters === undefined || resultAdapter === undefined) return undefined;
  return Object.freeze({
    contract, implementation, slot,
    parameters: Object.freeze(parameters),
    implementationParameters: Object.freeze(implementationParameters),
    returnCarrier, implementationReturnCarrier,
    parameterAdapters: Object.freeze(parameterAdapters),
    resultAdapter,
    adapterFallible: parameterAdapters.some(rustCallableParameterAdapterIsFallible) ||
      rustCallableValueAdapterIsFallible(resultAdapter),
  });

  function substitutions(owner: RustProjectTypeDefinition, member: Node): ReadonlyMap<string, TargetTypeRef> | undefined {
    const relation = projectTypes.relationship(receiver, owner);
    if (relation.kind !== "related") return undefined;
    const result = projectOwnerTypeSubstitutions(owner, relation.targetType);
    const declaredParameters = ast.typeParameters(member);
    if (!isDenseDataArray(declaredParameters) || declaredParameters.some(parameter => parameter === undefined)) return undefined;
    const parameters = (declaredParameters as readonly Node[]).filter(parameter =>
      walk.context.sourceLifetimes.parameterFor(parameter)?.kind !== "lifetime");
    if (parameters.length !== (variant?.targetTypeArguments.length ?? 0)) return undefined;
    for (const [index, parameter] of parameters.entries()) {
      const name = parameter === undefined ? undefined : ast.name(parameter);
      const argument = variant?.targetTypeArguments[index];
      if (name === undefined || argument === undefined) return undefined;
      result.set(ast.text(name), argument);
    }
    return result;
  }
}

function reject(walk: RustFactWalk, subject: Node, message: string): void {
  appendRustDiagnostic(walk, "RUST_PROJECT_METHOD_ADAPTER_NOT_PROVEN", message, subject,
    ["target.capability=rust.project-method.exact-adapter"]);
}
