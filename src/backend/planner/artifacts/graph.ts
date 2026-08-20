import type {
  AstReader,
  Node,
} from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { createTargetArtifactContractGraph } from "@tsonic/target-api/artifacts";
import { closedMetadataKey } from "../../../policy/model/closed-data.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type {
  TargetArtifactContractGraph,
  TargetArtifactDependency,
  TargetArtifactReconstruction,
} from "@tsonic/target-api/artifacts";
import type {
  RustArtifactFacet,
  RustArtifactSnapshot,
  RustSourceCallableContract,
} from "./contracts.js";
import {
  rustSourceCallableContractCandidate,
} from "./contracts.js";

export type RustArtifactRequestResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RustArtifactGraph {
  readonly revision: number;
  readonly contractGraph: TargetArtifactContractGraph<
    RustArtifactFacet,
    RustArtifactSnapshot
  >;
  captureDependencies<Value>(
    owner: string,
    build: () => Value,
  ): {
    readonly value: Value;
    readonly dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[];
  };
  publishSourceCallable(
    declaration: Node,
    callable: RustSourceCallableContract,
  ): RustArtifactRequestResult;
  sourceCallable(
    declaration: Node,
    sourceTypeArguments?: readonly TargetTypeRef[],
  ): RustSourceCallableContract | undefined;
  reconstructArtifact(
    owner: string,
  ): TargetArtifactReconstruction<RustArtifactFacet, RustArtifactSnapshot>;
  verifyContractClosure(): RustArtifactRequestResult;
}

export function createRustArtifactGraph(
  ast: AstReader,
): RustArtifactGraph {
  const contracts = createTargetArtifactContractGraph<
    RustArtifactFacet,
    RustArtifactSnapshot
  >();
  let activeDependencies:
    | Map<string, TargetArtifactDependency<RustArtifactFacet>>
    | undefined;

  function captureDependencies<Value>(
    owner: string,
    build: () => Value,
  ): {
    readonly value: Value;
    readonly dependencies: readonly TargetArtifactDependency<RustArtifactFacet>[];
  } {
    if (activeDependencies !== undefined) {
      throw new Error(
        `Rust target artifact '${owner}' attempted nested dependency capture.`,
      );
    }
    activeDependencies = new Map();
    try {
      const value = build();
      return {
        value,
        dependencies: Object.freeze(
          [...activeDependencies.values()].sort((left, right) =>
            left.owner.localeCompare(right.owner, "en") ||
            left.facet.localeCompare(right.facet, "en")
          ),
        ),
      };
    } finally {
      activeDependencies = undefined;
    }
  }

  function dependOn(owner: string, facet: RustArtifactFacet): void {
    if (activeDependencies === undefined) {
      return;
    }
    const key = `${owner.length}:${owner}${facet.length}:${facet}`;
    activeDependencies.set(key, Object.freeze({ owner, facet }));
  }

  function publishSourceCallable(
    declaration: Node,
    callable: RustSourceCallableContract,
  ): RustArtifactRequestResult {
    if (callable.sourceDeclaration !== declaration) {
      return rejected(
        "Rust source-callable publication conflicts with its exact source declaration.",
      );
    }
    const owner = sourceCallableOwner(ast, declaration, callable.sourceTypeArguments);
    if (owner === undefined) {
      return rejected(
        "Rust source-callable publication requires one stable compiler-owned declaration identity.",
      );
    }
    const candidate = rustSourceCallableContractCandidate(owner, callable);
    const committed = contracts.commit(
      candidate.owner,
      candidate.contract,
      candidate.dependencies,
      candidate.artifact,
    );
    return committed.kind === "accepted"
      ? accepted
      : rejected(committed.reason);
  }

  function sourceCallable(
    declaration: Node,
    sourceTypeArguments?: readonly TargetTypeRef[],
  ): RustSourceCallableContract | undefined {
    const owner = sourceCallableOwner(ast, declaration, sourceTypeArguments);
    if (owner === undefined) {
      return undefined;
    }
    dependOn(owner, "source-callable-surface");
    const artifact = contracts.artifact(owner);
    return artifact?.kind === "source-callable" &&
        artifact.contract.sourceDeclaration === declaration
      ? artifact.contract
      : undefined;
  }

  function reconstructArtifact(
    owner: string,
  ): TargetArtifactReconstruction<RustArtifactFacet, RustArtifactSnapshot> {
    const artifact = contracts.artifact(owner);
    if (artifact?.kind !== "source-callable") {
      return {
        kind: "rejected",
        code: "RUST_TARGET_ARTIFACT_RECONSTRUCTOR_MISSING",
        reason: `Dirty Rust target artifact '${owner}' has no target-owned reconstructor.`,
      };
    }
    const candidate = rustSourceCallableContractCandidate(
      owner,
      artifact.contract,
    );
    return {
      kind: "resolved",
      contract: candidate.contract,
      dependencies: candidate.dependencies,
      artifact: candidate.artifact,
    };
  }

  function verifyContractClosure(): RustArtifactRequestResult {
    if (contracts.hasPending()) {
      return rejected(
        "Rust target artifact contracts retain dirty dependents after reconstruction.",
      );
    }
    const closure = contracts.verifyClosure();
    return closure.kind === "closed" ? accepted : rejected(closure.reason);
  }

  return Object.freeze({
    get revision(): number {
      return contracts.revision;
    },
    contractGraph: contracts,
    captureDependencies,
    publishSourceCallable,
    sourceCallable,
    reconstructArtifact,
    verifyContractClosure,
  });
}

function sourceCallableOwner(
  ast: AstReader,
  declaration: Node,
  sourceTypeArguments?: readonly TargetTypeRef[],
): string | undefined {
  const identity = sourceNodeIdentity(ast, declaration);
  if (identity === undefined) {
    return undefined;
  }
  const instantiation = sourceTypeArguments === undefined
    ? "open"
    : `closed:${closedMetadataKey(sourceTypeArguments)}`;
  return `source-callable:${identity}:${instantiation}`;
}

function rejected(reason: string): RustArtifactRequestResult {
  return { kind: "rejected", reason };
}

const accepted: RustArtifactRequestResult = Object.freeze({ kind: "accepted" });
