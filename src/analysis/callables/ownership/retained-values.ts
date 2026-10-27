import type { RustRetainedEnvironmentSelection } from "../../../target-model/records/retained-environments.js";
import { rustHasOpenOwnedStorage, rustHasOpenCallableEnvironment, closeRustRetainedCallableCarrier } from "../../../policy/ownership/retained-storage.js";
import type { Node } from "@tsonic/tsts";
import type { RustSourcePolicyContext } from "../../../policy/model/context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

import { sourceEnclosingCallable, sourceNodeIdentity, sourceCallableValueParameters, sourceExpressionResultDisposition } from "@tsonic/target-api/source";
import { rustCallScopedElisionLifetime, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { selectRustSuspendedStorageLifetime } from "../../../policy/ownership/suspended-storage.js";
import { rustEnclosingStorageContract } from "../storage/storage-contracts.js";
import { rustTargetGenericReferences } from "../../../target-model/types/carriers/generic-references.js";
import { rustLifetimeOutlives } from "../../../policy/constraints/lifetime-outlives.js";
import { rustSourceTypeCarrierValue } from "../../../target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../../target-model/types/carriers/children.js";
import { projectGenericSubstitutions } from "../../../policy/types/project/generic-substitutions.js";
import type { RustProjectTypePolicy } from "../../project-types/index.js";
import type { RustObjectRepresentationPlan } from "../../project-types/object-representation.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustProjectObjectField } from "../../project-types/object-layout.js";

type RustRetainedValueNativeEvidence = { readonly kind: "signature" } | {
  readonly kind: "construction";
  readonly projectTypes: Pick<RustProjectTypePolicy, "definitionForCarrier" | "definitionContainingDeclaration" | "objectLayoutForDefinition">;
  readonly objectRepresentations: Pick<RustObjectRepresentationPlan, "nativeLifetimeFor">;
};

export function rustRetainedValueLifetime(
  declaration: Node, captures: readonly TargetTypeRef[],
  walk: { readonly context: Pick<RustSourcePolicyContext, "ast" | "source" | "sourceLifetimes" | "records" | "retainedEnvironments"> },
  native: RustRetainedValueNativeEvidence,
): RustLifetimeRef | undefined {
  const { context } = walk;
  const retainedScope = context.records.retainedEnvironment.get(declaration);
  const scopeLifetimes = retainedScope?.inputs.some(input => input.kind === "native-task-scope") ? [retainedScope.lifetime] : [];
  const contract = rustEnclosingStorageContract(declaration, context.ast, context.sourceLifetimes);
  const capturedLifetime = selectRustSuspendedStorageLifetime({ carriers: captures, lifetimes: scopeLifetimes }, contract);
  if (!captures.some(rustHasOpenOwnedStorage)) return capturedLifetime;
  const owner = sourceEnclosingCallable(context.ast.parent(declaration), context.ast);
  const parameters = owner === undefined ? []
    : sourceCallableValueParameters(context.ast, owner, context.source.semantics.forNode(owner));
  if (parameters === undefined) return undefined;
  const selected = owner === undefined ? { kind: "none" as const } : rustRetainedEnvironment(owner,
    parameters.map(parameter => context.records.sourceParameterAbi.get(parameter)?.parameterCarrier), context);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "selected") return selected.environment.lifetime;
  if (native.kind === "construction" && capturedLifetime?.kind === "static" &&
    (context.ast.is.IsArrowFunction(declaration) || context.ast.is.IsFunctionExpression(declaration))) {
    const disposition = sourceExpressionResultDisposition(context.ast, declaration);
    const field = disposition.kind === "stored" && context.ast.is.IsPropertyDeclaration(disposition.use)
      ? rustProjectObjectField(disposition.use, native.projectTypes) : undefined;
    const definition = field === undefined ? undefined : native.projectTypes.definitionContainingDeclaration(field.declaration);
    if (definition !== undefined) {
      const storage = native.objectRepresentations.nativeLifetimeFor(definition);
      if (storage === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native callable field requires its original prepared lifetime contract.", field?.declaration);
      if (storage.ownedCallableFieldLifetime !== undefined) return storage.ownedCallableFieldLifetime;
    }
  }
  const references = rustTargetGenericReferences({ kind: "tuple", elements: captures });
  const nativeOutlives = new Map<string, RustLifetimeRef[]>();
  if (native.kind === "construction") {
    const pending = [...captures];
    const seen = new Set<TargetTypeRef>();
    for (let index = 0; index < pending.length; index++) {
      const carrier = pending[index]!;
      if (seen.has(carrier)) continue;
      seen.add(carrier);
      const source = rustSourceTypeCarrierValue(carrier);
      const definition = source === undefined ? undefined : native.projectTypes.definitionForCarrier(carrier);
      if (definition !== undefined) {
        const contract = native.objectRepresentations.nativeLifetimeFor(definition);
        if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust", "A captured native object requires its original prepared lifetime contract.", declaration);
        if (contract.typeOutlives.length !== 0) {
          const bindings = projectGenericSubstitutions(definition, source!.genericArguments);
          if (bindings === undefined) return undefined;
          for (const requirement of contract.typeOutlives) {
            const argument = bindings.types.get(requirement.identity);
            if (argument?.kind !== "type-parameter") continue;
            const values = nativeOutlives.get(argument.identity) ?? [];
            values.push(requirement.lifetime);
            nativeOutlives.set(argument.identity, values);
          }
        }
      }
      pending.push(...rustTargetTypeChildren(carrier));
    }
  }
  if (capturedLifetime !== undefined && references.typeIdentities.every(identity => {
    const parameter = contract?.parameters.find(parameter => parameter.kind === "type" && parameter.identity === identity);
    return (nativeOutlives.get(identity) ?? []).some(lifetime => rustLifetimeOutlives(lifetime, capturedLifetime, contract)) ||
      parameter?.kind === "type" && parameter.outlives.some(lifetime => rustLifetimeOutlives(lifetime, capturedLifetime, contract));
  })) return capturedLifetime;
  const identity = sourceNodeIdentity(context.ast, declaration);
  return identity === undefined ? undefined : rustCallScopedElisionLifetime(identity, "owned-environment");
}

export function rustSuspendedCapturedParameters(declaration: Node, context: RustSourcePolicyContext): readonly Node[] | undefined {
  return context.retainedEnvironments.suspendedParametersFor(declaration);
}

export function rustRetainedEnvironment(
  declaration: Node,
  parameterCarriers: readonly (TargetTypeRef | undefined)[],
  context: Pick<RustSourcePolicyContext, "source" | "retainedEnvironments">,
): RustRetainedEnvironmentSelection {
  const parameters = sourceCallableValueParameters(context.source.ast, declaration, context.source.semantics.forNode(declaration));
  if (parameters === undefined || parameters.length !== parameterCarriers.length ||
    parameterCarriers.some(carrier => carrier === undefined)) return { kind: "unresolved",
      reason: "A retained native environment requires exact declaration-owned input carriers." };
  const openParameters = new Set(parameters.filter((parameter, index) => {
    const carrier = parameterCarriers[index];
    return parameter !== undefined && carrier !== undefined && rustHasOpenOwnedStorage(carrier);
  }));
  const none = Object.freeze({ kind: "none" as const });
  const selected = context.retainedEnvironments.environmentFor(declaration);
  if (selected.kind === "selected") return selected.environment.inputs.some(input => input.kind === "native-task-scope" ||
    openParameters.has(input.declaration)) ? selected : none;
  return openParameters.size === 0 ? none : selected;
}

export function closeRustRetainedParameter(
  parameter: Node, carrier: TargetTypeRef, context: RustSourcePolicyContext,
): TargetTypeRef | undefined {
  if (!rustHasOpenCallableEnvironment(carrier)) return carrier;
  if (!context.ast.is.IsParameterDeclaration(parameter)) return undefined;
  const declaration = context.ast.parent(parameter);
  if (declaration === undefined || sourceCallableValueParameters(context.ast, declaration,
    context.source.semantics.forNode(declaration))?.includes(parameter) !== true) return undefined;
  const selected = context.retainedEnvironments.environmentFor(declaration);
  if (selected.kind === "unresolved") return undefined;
  if (selected.kind === "none") {
    const inputs = context.retainedEnvironments.inputsFor(declaration);
    if (inputs.kind === "unresolved") return undefined;
    const retained = inputs.ownership === "owned"
      ? context.retainedEnvironments.suspendedParametersFor(declaration) : undefined;
    return retained?.includes(parameter) === true ? closeRustRetainedCallableCarrier(carrier, { kind: "static" }) : carrier;
  }
  if (!selected.environment.inputs.some(input => input.kind === "parameter" && input.declaration === parameter)) return carrier;
  return closeRustRetainedCallableCarrier(carrier, selected.environment.lifetime);
}
