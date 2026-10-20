import type { Node } from "@tsonic/tsts";
import { isSourceCallableBodyBoundary } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustArrayLiteralProducer } from "../program/records/array-literals.js";
import type { RustBorrowedSequenceEmission } from "../../target-model/records/array-literals.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustVecTargetType } from "../../target-model/types/index.js";

export function analyzeRustArrayLiterals(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustArrayLiteralProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const node of nodes) {
    const literal = program.records.targetOperation.get(node);
    if (literal?.kind !== "array-literal") continue;
    let owner: Node | undefined = program.source.ast.parent(node);
    while (owner !== undefined && !isSourceCallableBodyBoundary(program.source.ast, owner)) owner = program.source.ast.parent(owner);
    const body = owner !== undefined && program.records.callableDeclaration.get(owner)?.nativeBody !== undefined ? true : undefined;
    for (const contribution of literal.contributions) {
      if (contribution.kind !== "spread" || producer.records.borrowedSequenceEmission.get(contribution.input, literal.elementCarrier) !== undefined) continue;
      const branches: RustBorrowedSequenceEmission["inputs"][number][] = [];
      for (const input of contribution.input.inputs) {
        if (input.kind === "empty") { branches.push(Object.freeze({ kind: "empty" })); continue; }
        const contract = rustValueConversionContract(input.conversion, program.typeDefinitions);
        if (contract?.lowering !== "rest-sequence" || !rustTargetTypeRefEquals(contract.source, input.presentCarrier) ||
          !rustTargetTypeRefEquals(contract.target, rustVecTargetType(literal.elementCarrier)))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted source array spread requires its exact native element conversion.", input.expression);
        const clone = contract.cloneSources.every(carrier => owner === undefined ? program.records.carrierRead.get(carrier)?.clone === true
          : program.records.carrierClone.get(carrier, owner, body) === true);
        if (!clone) {
          issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
            message: `Borrowed sequence selection lost its exact native presence, storage or element conversion. Node kind: ${program.source.ast.kindName(node)}.`,
            evidence: ["target.capability=rust.backend.borrowed-sequence"] });
          continue;
        }
        branches.push(Object.freeze({ kind: "sequence", expression: input.expression, optional: input.optional, contract,
          mode: input.optional || contract.collection === "js-array" || input.presentCarrier.kind === "reference" ? "shared-receiver" : "shared-reference" }));
      }
      producer.borrowed(contribution.input, literal.elementCarrier, { inputs: Object.freeze(branches) });
    }
  }
  return Object.freeze(issues);
}
