import type {
  TargetBackendContext,
  TargetCompileInput,
} from "@tsonic/target-api";
import type { RustTargetProgram } from "../../analysis/program/model.js";
import {
  createRustArtifactGraph,
} from "./artifacts/index.js";
import type {
  RustArtifactGraph,
} from "./artifacts/index.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

export interface RustPlanningContext
  extends TargetCompileInput,
    RustTargetProgram {
  readonly backend: TargetBackendContext;
  readonly program: RustTargetProgram;
  readonly artifacts: RustArtifactGraph;
  readonly providerErrorCarriers: TargetTypeRef[];
}

export function createRustPlanningContext(
  backend: TargetBackendContext,
  input: TargetCompileInput,
  program: RustTargetProgram,
): RustPlanningContext {
  return Object.freeze({
    ...input,
    ...program,
    backend,
    program,
    artifacts: createRustArtifactGraph(program.ast),
    providerErrorCarriers: [],
  });
}

export function registerRustProviderErrorCarrier(
  context: RustPlanningContext,
  carrier: TargetTypeRef,
): void {
  if (!context.providerErrorCarriers.some((candidate) =>
    rustTargetTypeRefEquals(candidate, carrier))) {
    context.providerErrorCarriers.push(carrier);
  }
}
