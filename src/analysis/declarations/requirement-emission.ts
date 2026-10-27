import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustNativeGenericProducer } from "../program/records/native/native-generics.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { requirementUseHasValidStorage } from "./generic-requirement-contract.js";
import { rustPhysicalEmissionRecordCarriers } from "../callables/emission/emission-contexts.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustGenericRequirementEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustNativeGenericProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const carriers = new Map<Node, Map<string, TargetTypeRef>>();
  const append = (declaration: Node, values: readonly TargetTypeRef[]): void => {
    const selected = carriers.get(declaration) ?? new Map<string, TargetTypeRef>();
    const pending = [...values];
    for (let index = 0; index < pending.length; index++) {
      const carrier = pending[index]!;
      const key = closedMetadataKey(carrier);
      if (selected.has(key)) continue;
      selected.set(key, carrier);
      pending.push(...rustTargetTypeChildren(carrier));
    }
    carriers.set(declaration, selected);
  };
  const declarations = new Set([...nodes, ...program.projectTypes.definitions.map(definition => definition.declaration)]);
  const contracts = new Set<Node>();
  for (const declaration of declarations) {
    const source = program.declarationGenericRequirements.contractFor(declaration);
    const body = program.declarationGenericRequirements.contractFor(declaration, true);
    if (source === undefined && body === undefined) continue;
    contracts.add(declaration);
    producer.requirements(declaration, source, body);
    for (const mode of [undefined, true] as const) {
      const contract = mode === true ? body : source;
      const seenUses = new Set<string>();
      const nodeIds = new Map<Node, number>();
      for (const use of contract?.uses ?? []) {
        const identity = nodeIds.get(use.node) ?? nodeIds.size;
        nodeIds.set(use.node, identity);
        const key = closedMetadataKey([identity, use.carrier, [...new Set(use.requirements)].sort()]);
        if (seenUses.has(key)) continue;
        seenUses.add(key);
        if (!requirementUseHasValidStorage(use)) {
          issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: use.node,
            message: `A generated Rust operation is absent from its sealed callable generic-requirement contract. Node kind: ${program.source.ast.kindName(use.node)}.`,
            evidence: ["target.capability=rust.backend.generic-requirement-classification"] });
          continue;
        }
        producer.use(declaration, use.node, use.carrier, use.requirements, mode);
        append(declaration, [use.carrier]);
      }
    }
  }
  for (const context of program.physicalEmissionContexts.contexts) append(context.declaration,
    [...context.operands, ...(context.returnDestination.kind === "value" ? [context.returnDestination.carrier] : [])]);
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    let declaration: Node | undefined = node;
    while (declaration !== undefined && !contracts.has(declaration)) declaration = program.source.ast.parent(declaration);
    // Outside every generic requirement contract the enclosing callable owns the clone guarantees its reads query.
    declaration ??= sourceEnclosingCallable(node, program.source.ast);
    if (declaration !== undefined) append(declaration, rustPhysicalEmissionRecordCarriers(program.records, node));
  }
  for (const [declaration, selected] of carriers) for (const carrier of selected.values()) for (const mode of [undefined, true] as const)
    producer.clone(carrier, declaration, mode, rustCarrierSupportsClone(carrier, program.typeDefinitions) ||
      program.declarationGenericRequirements.supportsClone(declaration, carrier, mode));
  return Object.freeze(issues);
}
