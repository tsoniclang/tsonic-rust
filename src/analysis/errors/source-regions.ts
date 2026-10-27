import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustErrorEmissionProducer } from "../program/records/errors/error-emission.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/errors/source-error-effects.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/errors/error-effects.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustSourceErrorRegionSelection } from "../../target-model/records/errors/error-regions.js";
import type { RustSourceErrorRegionEmission } from "../../target-model/records/errors/error-emission.js";

export function materializeRustSourceErrorRegion(node: Node,
  selected: RustSourceErrorRegionSelection): RustSourceErrorRegionEmission {
  const sources = new Map(selected.operand.sources.map(source => [source.identity, source]));
  const channels = new Map(selected.channels.map(channel => {
    const source = sources.get(channel.sourceIdentity);
    if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted error channel requires its exact source carrier.", node);
    return [channel.sourceIdentity, Object.freeze({ targetIdentity: channel.targetIdentity, uninhabited: channel.uninhabited,
      jsRejection: channel.targetIdentity === rustJsRejectionErrorIdentity && rustTargetTypeRefEquals(source.errorType, rustJsValueTargetType()) })] as const;
  }));
  return Object.freeze({ operand: selected.operand, local: selected.local, channels });
}

export function analyzeRustSourceErrorRegions(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustErrorEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const published = new Set<RustSourceErrorEffectEdge>();
  for (const node of nodes) for (const edge of program.records.sourceErrorEffects.get(node)?.edges ?? []) {
    if (published.has(edge)) continue;
    const selected = program.errorRegions.sourceFor(edge);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted source error edge requires its completed native region.", node);
    producer.sourceRegion(edge, materializeRustSourceErrorRegion(node, selected));
    published.add(edge);
  }
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const branches = program.records.awaitSourceErrorEffects.get(node)?.branches ?? [];
    const selections = new Map<string, typeof branches[number]>();
    const duplicates = new Set<string>();
    for (const branch of branches) {
      const key = closedMetadataKey(branch.carrier);
      if (selections.has(key)) duplicates.add(key);
      else selections.set(key, branch);
    }
    if (duplicates.size !== 0) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
        message: `A fallible await requires its exact selected error channel in the active region. Node kind: ${program.source.ast.kindName(node)}.`,
        evidence: ["target.capability=rust.backend.await-error-channel"] });
      continue;
    }
    for (const branch of selections.values()) producer.awaitEdge(node, branch.carrier, branch.edge);
  }
  return Object.freeze(issues);
}
