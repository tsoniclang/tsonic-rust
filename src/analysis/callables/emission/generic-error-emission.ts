import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustGenericCallableErrorIndex } from "../../../target-model/records/callables/generic-callable-errors.js";
import type { RustGenericCallablePhysicalPlan } from "../../../target-model/records/callables/generic-callables.js";
import type { RustErrorRegionRecords } from "../../../target-model/records/errors/error-regions.js";
import type { RustErrorEmissionProducer } from "../../program/records/errors/error-emission.js";
import type { RustGenericCallableMemberErrorEmission } from "../../../target-model/records/errors/error-emission.js";
import type { RustGenericCallablePhysicalMember } from "../../../target-model/records/callables/generic-callables.js";

export function analyzeRustGenericErrorEmission(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly nodes: readonly Node[];
  readonly regions: RustErrorRegionRecords;
  readonly index: RustGenericCallableErrorIndex;
  readonly physical: RustGenericCallablePhysicalPlan;
  readonly producer: RustErrorEmissionProducer;
}): void {
  for (const sourceFile of input.sourceFiles) {
    const fileName = input.ast.getFileName(sourceFile);
    input.producer.joins(fileName, input.regions.declarationsFor(fileName));
  }
  for (const node of input.nodes) {
    const region = input.regions.get(node);
    if (region !== undefined) input.producer.region(node, region);
  }
  for (const definition of input.physical.definitions()) {
    const selected = input.index.forDefinition(definition);
    if (selected === undefined) continue;
    const members = new Map<RustGenericCallablePhysicalMember, RustGenericCallableMemberErrorEmission>();
    for (const member of definition.members) {
      const value = selected.members.get(member);
      if (value === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted generic callable requires its exact native member error channels.", member.implementation.declaration);
      members.set(member, value);
    }
    input.producer.generic(definition, { effects: selected.effects, invocation: selected.invocation, awaiting: selected.awaiting, members });
  }
}
