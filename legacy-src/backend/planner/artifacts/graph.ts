import { createTargetArtifactContractGraph } from "@tsonic/target-api/artifacts";
import type {
  TargetArtifactContractGraph,
} from "@tsonic/target-api/artifacts";
import type {
  RustArtifactFacet,
  RustArtifactSnapshot,
} from "./contracts.js";

export type RustArtifactRequestResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustArtifactGraph {
  readonly contractGraph: TargetArtifactContractGraph<
    RustArtifactFacet,
    RustArtifactSnapshot
  >;
  verifyContractClosure(): RustArtifactRequestResult;
}

export function createRustArtifactGraph(): RustArtifactGraph {
  const contractGraph = createTargetArtifactContractGraph<
    RustArtifactFacet,
    RustArtifactSnapshot
  >();
  return Object.freeze({
    contractGraph,
    verifyContractClosure(): RustArtifactRequestResult {
      if (contractGraph.hasPending()) {
        return {
          kind: "rejected",
          reason: "Rust target artifact contracts retain dirty dependents after reconstruction.",
        };
      }
      const closure = contractGraph.verifyClosure();
      return closure.kind === "closed"
        ? Object.freeze({ kind: "accepted" })
        : { kind: "rejected", reason: closure.reason };
    },
  });
}
