import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustOptionalChainEmission } from "../../target-model/records/optional-chain-emission.js";
import type { RustOptionalChainEmissionProducer } from "../program/records/optional-chain-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/required-records.js";
import { isRustUnitCarrier, rustOptionElementCarrier, rustOptionNestingDepth, rustStructuralMethodCallableCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { analyzeRustOptionalChainBodyFallibility } from "../errors/optional-chains.js";

export function analyzeRustOptionalChainEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustOptionalChainEmissionProducer, required: RustRequiredRecord[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.optionalChain.get(node);
    if (fact === undefined) continue;
    const operation = program.records.targetOperation.get(node);
    const result = program.records.runtimeCarrier.get(node)?.carrier;
    const guard = program.records.runtimeCarrier.get(fact.guard)?.carrier;
    const depth = rustOptionNestingDepth(fact.sourceGuardCarrier, fact.selectedGuardCarrier);
    const finalRelationship = fact.lowering === "map"
      ? rustTargetTypeRefEquals(fact.resultCarrier, rustSourceOptionalTargetType(fact.innerResultCarrier))
      : rustOptionElementCarrier(fact.innerResultCarrier) !== undefined && rustTargetTypeRefEquals(fact.resultCarrier, fact.innerResultCarrier);
    const expectedKind = ast.is.IsCallExpression(node) ? "method" : ast.is.IsPropertyAccessExpression(node) ||
      program.records.selectedOperation.get(node)?.operationKind === "property" ? "property" : "indexer";
    if (fact.expression !== node || fact.operationKind !== expectedKind || result === undefined || guard === undefined ||
      !rustTargetTypeRefEquals(result, fact.resultCarrier) || !rustTargetTypeRefEquals(guard, fact.sourceGuardCarrier) ||
      depth === undefined || depth === 0 || depth !== fact.guardDepth || !finalRelationship) {
      refuse(node, "rust.backend.optional-chain-contract", "Optional-chain lowering conflicts with its exact guard, selected receiver, operation, or result carriers.");
      continue;
    }
    let structuralGuard: RustOptionalChainEmission["structuralGuard"];
    if (operation?.kind === "source-call" && operation.target.form === "structural-method") {
      const callee = ast.is.IsCallExpression(node) ? Node_Expression(ast, node) : undefined;
      const field = program.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex);
      if (callee === fact.guard && field?.method === true && field.presence === "optional") {
        const receiverNode = callee !== undefined && ast.is.IsPropertyAccessExpression(callee) ? Node_Expression(ast, callee) : undefined;
        const storage = field.methodPlan?.carrier;
        const selectedStorageCarrier = rustOptionElementCarrier(storage);
        if (receiverNode === undefined || storage === undefined || selectedStorageCarrier === undefined ||
          !rustTargetTypeRefEquals(fact.sourceGuardCarrier, field.carrier) ||
          !rustTargetTypeRefEquals(fact.selectedGuardCarrier, rustStructuralMethodCallableCarrier(field.carrier, field.presence))) {
          refuse(node, "rust.backend.optional-structural-method-guard", "Optional structural-method lowering conflicts with its exact receiver-bound callable storage contract.");
          continue;
        }
        structuralGuard = Object.freeze({ receiverNode, receiverCarrier: operation.target.receiverCarrier,
          storageIndex: operation.target.storageIndex, selectedStorageCarrier });
      }
    }
    const read = program.records.flowReadProjection.get(fact.guard);
    if (structuralGuard === undefined && read !== undefined && !rustTargetTypeRefEquals(read.sourceCarrier, fact.selectedGuardCarrier) &&
      !(read.kind === "option-value" && rustTargetTypeRefEquals(read.sourceCarrier, fact.sourceGuardCarrier) &&
        rustTargetTypeRefEquals(read.selectedCarrier, fact.selectedGuardCarrier))) {
      refuse(fact.guard, "rust.backend.optional-chain-flow-read", "Optional-chain lowering conflicts with the separately finalized receiver projection.");
      continue;
    }
    const unit = isRustUnitCarrier(fact.innerResultCarrier);
    const closure = unit || !presentBranchIsPure(node, fact.guard) ? undefined
      : fact.lowering === "map" ? "map" as const : "and_then" as const;
    producer.publish(node, { fact, structuralGuard, unit, closure });
    requireRustRecord(required, "optionalChainEmission", node, "optional-chain", "analysis/operations/optional-chains.ts");
  }
  return Object.freeze(issues);

  // The present branch (everything the chain evaluates after its guard) can run inside a closure when no node in it
  // suspends, yields or carries error effects. Error effects are recorded on the calls and awaits that carry them.
  function presentBranchIsPure(root: Node, guard: Node): boolean {
    if (analyzeRustOptionalChainBodyFallibility({ ast, records: program.records, structural: program.structuralShapes,
      dispatch: program.projectFieldDispatch, frozen: program.frozenDataWrites, definitions: program.typeDefinitions }, root, guard)) return false;
    const pending = [root];
    for (let index = 0; index < pending.length; index++) {
      if (index > 4096) return false;
      const current = pending[index]!;
      if (ast.is.IsAwaitExpression(current) || ast.is.IsYieldExpression(current)) return false;
      ast.forEachChild(current, child => { if (child !== undefined && child !== guard) pending.push(child); });
    }
    return true;
  }
}
