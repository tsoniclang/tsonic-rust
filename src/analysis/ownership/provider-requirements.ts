import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import type {
  RustProviderTypeRequirement,
  RustResolvedProviderTypeParameterRequirement,
} from "../../target-model/operations/model.js";
import { rustBoundSemanticKey } from "../../target-model/semantics/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustResolvedProviderRequirementKey } from "../../policy/types/provider-generic-requirements.js";
import type { RustCaptureAnalysis } from "./captures.js";
import type {
  RustOwnershipAnalysisInput,
  RustOwnershipEnvironment,
} from "./context.js";
import { rustOwnershipDiagnostic } from "./diagnostics.js";
import type { RustOwnershipNodeInventory } from "./inventory.js";
import { rustFutureProviderRequirementIsProven } from "./future-requirements.js";

export function validateRustProviderTypeRequirements(
  inventory: RustOwnershipNodeInventory,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
  diagnostics: TargetDiagnostic[],
): void {
  for (const node of inventory.nodes) {
    const operation = input.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind !== "provider-operation" && operation?.kind !== "runtime-set") {
      continue;
    }
    for (const requirement of operation.abi.typeRequirements) {
      for (const bound of requirement.requirements) {
        const failure = providerRequirementFailure(
          node,
          requirement,
          bound,
          captures,
          input,
          environment,
        );
        if (failure === undefined) continue;
        diagnostics.push(rustOwnershipDiagnostic(
          failure.code,
          failure.message,
          node,
          Object.freeze([
            `provider.requirement.source=${requirement.sourceName}`,
            `provider.requirement.bound=${rustBoundSemanticKey(bound)}`,
          ]),
        ));
      }
    }
  }
}

function providerRequirementFailure(
  operation: Node,
  requirement: RustResolvedProviderTypeParameterRequirement,
  bound: RustProviderTypeRequirement,
  captures: RustCaptureAnalysis,
  input: RustOwnershipAnalysisInput,
  environment: RustOwnershipEnvironment,
): { readonly code: string; readonly message: string } | undefined {
  const captureProof = captures.providerRequirementIsProven(
    operation,
    rustResolvedProviderRequirementKey(requirement, bound),
  );
  const futureProof = rustFutureProviderRequirementIsProven(
    operation,
    requirement,
    bound,
    captures,
    input,
    environment,
  );
  switch (bound.kind) {
    case "trait":
      if (bound.polarity === "maybe") return undefined;
      if (bound.polarity === "negative") {
        return {
          code: "RUST_PROVIDER_GENERIC_NEGATIVE_REQUIREMENT_NOT_PROVEN",
          message: `Provider generic '${requirement.sourceName}' requires exact negative trait evidence that the closed carrier does not provide.`,
        };
      }
      return environment.supportsTraitBound(requirement.carrier, bound) || captureProof || futureProof
        ? undefined
        : {
            code: "RUST_PROVIDER_GENERIC_TRAIT_REQUIREMENT_NOT_PROVEN",
            message: `Provider generic '${requirement.sourceName}' requires an exact trait implementation that is not proven for its closed carrier.`,
          };
    case "lifetime-outlives":
      return environment.lifetimeOutlives(bound.longer, bound.shorter)
        ? undefined
        : {
            code: "RUST_PROVIDER_GENERIC_LIFETIME_REQUIREMENT_NOT_PROVEN",
            message: `Provider generic '${requirement.sourceName}' has a lifetime relation that is not proven by the sealed ownership graph.`,
          };
    case "type-outlives": {
      const requirementOutlives = requirement.carrier.kind === "closure" &&
        rustTargetTypeRefEquals(bound.type, requirement.carrier)
          ? captureProof
          : futureProof
            ? true
            : environment.typeOutlives(bound.type, bound.lifetime);
      return requirementOutlives
        ? undefined
        : {
            code: "RUST_PROVIDER_GENERIC_LIFETIME_REQUIREMENT_NOT_PROVEN",
            message: `Provider generic '${requirement.sourceName}' has a type-outlives requirement that is not proven by the sealed ownership graph.`,
          };
    }
    case "associated-equality":
      return {
        code: "RUST_PROVIDER_GENERIC_ASSOCIATED_REQUIREMENT_NOT_RESOLVED",
        message: `Provider generic '${requirement.sourceName}' retains an associated-type equality that operation instantiation did not resolve.`,
      };
    case "precise-capture":
      return undefined;
  }
}
