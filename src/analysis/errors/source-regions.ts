import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustErrorEmissionProducer } from "../program/records/error-emission.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/error-effects.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustSourceErrorRegions(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustErrorEmissionProducer): void {
  const published = new Set<RustSourceErrorEffectEdge>();
  for (const node of nodes) for (const edge of program.records.sourceErrorEffects.get(node)?.edges ?? []) {
    if (published.has(edge)) continue;
    const selected = program.errorRegions.sourceFor(edge);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted source error edge requires its completed native region.", node);
    const channels = new Map(selected.channels.map(channel => {
      const source = selected.operand.sources.find(source => source.identity === channel.sourceIdentity);
      if (source === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted error channel requires its exact source carrier.", node);
      return [channel.sourceIdentity, Object.freeze({ targetIdentity: channel.targetIdentity, uninhabited: channel.uninhabited,
        jsRejection: channel.targetIdentity === rustJsRejectionErrorIdentity && rustTargetTypeRefEquals(source.errorType, rustJsValueTargetType()) })] as const;
    }));
    producer.sourceRegion(edge, { operand: selected.operand, channels });
    published.add(edge);
  }
}
