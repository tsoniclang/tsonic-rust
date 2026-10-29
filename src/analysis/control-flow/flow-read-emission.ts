import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "./compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustFlowReadEmissionProducer } from "../program/records/operations/flow-read-emission.js";
import type { RustFlowReadProjectionFact } from "../../target-model/records/objects/value-projections.js";
import type { RustOptionalChainFact } from "../../target-model/operations/model.js";
import { rustFlowReadProjectionMatches } from "./flow-read-projections.js";
import { selectRustUnionMappingEmission, selectRustUnionProjectionEmission } from "../../policy/conversions/union-mappings.js";
import { rustOptionElementCarrier, isRustProgramErrorCarrier, rustJsErrorTargetType } from "../../target-model/types/index.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier, isRustWritableSourceErrorCarrier,
  isRustWritableRetainedErrorCarrier, isRustMutableJsErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustCaughtErrorReadCarrier, rustCaughtErrorPhysicalView } from "../errors/catching-try.js";

export function analyzeRustFlowReadEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustFlowReadEmissionProducer): readonly TargetDiagnostic[] {
  const guardStages = new Map<Node, RustOptionalChainFact | null>();
  for (const operation of nodes) {
    const chain = program.records.optionalChainEmission.get(operation)?.fact;
    if (chain === undefined) continue;
    const existing = guardStages.get(chain.guard);
    guardStages.set(chain.guard, chain.expression !== operation || existing !== undefined && existing !== chain ? null : chain);
  }
  const seen = new Set<RustFlowReadProjectionFact>();
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const prepare = (node: Node, fact: RustFlowReadProjectionFact | undefined): void => {
    if (fact === undefined || seen.has(fact)) return;
    seen.add(fact);
    if (!rustFlowReadProjectionMatches(fact, program.projectTypes, program.typeDefinitions)) {
      refuse(node, "rust.backend.value-projection", "Value projection conflicts with its exact sealed native carrier relation."); return;
    }
    if (fact.kind === "union-map") {
      const source = rustOptionElementCarrier(fact.sourceCarrier);
      const target = rustOptionElementCarrier(fact.selectedCarrier);
      const mapping = !rustTargetTypeRefEquals(source ?? fact.sourceCarrier, fact.dispatchCarrier) ? undefined
        : selectRustUnionMappingEmission(fact.dispatchCarrier, target ?? fact.selectedCarrier,
          fact.arms, "target", source !== undefined, target !== undefined, program.typeDefinitions);
      if (mapping === undefined) { refuse(node, "rust.backend.union-map", "Union flow projection requires exact sealed arm and absence correspondence."); return; }
      producer.publish(node, fact, { kind: "union-map", mapping });
    } else if (fact.kind === "source-union" || fact.kind === "runtime-union") {
      const projection = selectRustUnionProjectionEmission(fact.sourceCarrier, fact.project?.sourceCarrier ?? fact.selectedCarrier, program.typeDefinitions);
      if (projection === undefined || (program.typeDefinitions.sourceUnionVariants(fact.dispatchCarrier) !== undefined) !== (fact.kind === "source-union") ||
        projection.variant.name !== fact.variant || !rustTargetTypeRefEquals(projection.dispatchCarrier, fact.dispatchCarrier)) {
        refuse(node, "rust.backend.source-union-projection", "The selected union payload has no exact non-consuming projection."); return;
      }
      producer.publish(node, fact, { kind: "union", projection });
    } else if (fact.kind === "option-value" || fact.kind === "option-reference") {
      producer.publish(node, fact, { kind: "option", custom: rustOptionalStorageValue(fact.sourceCarrier) !== undefined,
        reborrow: fact.kind === "option-reference", readonlyReference: fact.selectedCarrier.kind === "reference" && !fact.selectedCarrier.mutable });
    } else if (fact.kind === "builtin-error") {
      const physical = isRustProgramErrorCarrier(fact.sourceCarrier)
        ? rustCaughtErrorReadCarrier(program.source.ast, program.records, node) : undefined;
      if (physical !== undefined && rustTargetTypeRefEquals(physical, fact.selectedCarrier) ||
        rustCaughtErrorPhysicalView(program.source.ast, program.records, node) !== undefined) {
        producer.publish(node, fact, { kind: "identity" });
        return;
      }
      producer.publish(node, fact, { kind: "builtin-error",
        source: isRustClosedValueCarrier(fact.sourceCarrier) ? "closed" : isRustProgramErrorCarrier(fact.sourceCarrier) ? "program"
          : isRustSourceErrorCarrier(fact.sourceCarrier) ? "source" : isRustRetainedErrorCarrier(fact.sourceCarrier) ? "retained" : "native",
        target: isRustSourceErrorCarrier(fact.selectedCarrier) ? "source" : isRustRetainedErrorCarrier(fact.selectedCarrier) ? "retained" : "native",
        writable: isRustWritableSourceErrorCarrier(fact.selectedCarrier) || isRustWritableRetainedErrorCarrier(fact.selectedCarrier),
        mutable: isRustMutableJsErrorCarrier(fact.selectedCarrier), runtimeReadonly: rustTargetTypeRefEquals(fact.selectedCarrier, rustJsErrorTargetType()) });
    } else producer.publish(node, fact, { kind: fact.kind === "closed-native" ? "closed-native" : fact.kind === "program-error-variant" ? "program-error-variant" : "project" });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.flowReadProjection.get(node);
    const raw = program.records.runtimeCarrier.get(node)?.carrier;
    const guard = guardStages.get(node);
    if (fact !== undefined && !rustTargetTypeRefEquals(raw, fact.sourceCarrier) &&
      !(guard !== undefined && guard !== null && rustTargetTypeRefEquals(raw, guard.sourceGuardCarrier) &&
        rustTargetTypeRefEquals(fact.sourceCarrier, guard.selectedGuardCarrier)))
      refuse(node, "rust.backend.flow-read-source", "The finalized flow-read projection conflicts with the expression's raw Rust carrier.");
    prepare(node, fact);
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "source-call") prepare(node, operation.resultProjection);
  }
  return Object.freeze(issues);
}
