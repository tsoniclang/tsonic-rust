import type { TargetCompileInput } from "@tsonic/target-api";
import type { RustTargetProgram } from "../../analysis/program/model.js";
import {
  createRustArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustArtifactGraph,
} from "./artifacts/index.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export interface RustPlanningContext {
  readonly input: TargetCompileInput;
  readonly program: RustTargetProgram;
  readonly artifacts: RustArtifactGraph;
  readonly providerErrors: RustProviderErrorPlan;
}

export interface RustProviderErrorPlan {
  register(carrier: TargetTypeRef): void;
  seal(): readonly TargetTypeRef[];
}

export function createRustPlanningContext(
  input: TargetCompileInput,
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    input,
    program,
    artifacts: createRustArtifactGraph(program.source.ast),
    providerErrors: createRustProviderErrorPlan(),
  });
}

function createRustProviderErrorPlan(): RustProviderErrorPlan {
  const carriers: TargetTypeRef[] = [];
  let sealed: readonly TargetTypeRef[] | undefined;
  return Object.freeze({
    register(carrier: TargetTypeRef): void {
      if (sealed !== undefined) {
        throw new Error("Rust provider-error planning is sealed.");
      }
      if (!carriers.some((candidate) =>
    rustTargetTypeRefEquals(candidate, carrier))) {
        carriers.push(carrier);
      }
    },
    seal(): readonly TargetTypeRef[] {
      sealed ??= Object.freeze([...carriers]);
      return sealed;
    },
  });
}
