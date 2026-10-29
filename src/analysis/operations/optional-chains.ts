import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression, Node_Initializer, sourceEnclosingCallable, sourceTransparentExpressionOperand } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustOptionalChainEmission } from "../../target-model/records/operations/optional-chain-emission.js";
import type { RustOptionalChainEmissionProducer } from "../program/records/operations/optional-chain-emission.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import { isRustUnitCarrier, rustOptionElementCarrier, rustOptionNestingDepth, rustStructuralMethodCallableCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustSourceOptionalTargetType } from "../../target-model/types/projections.js";
import { analyzeRustOptionalChainBodyFallibility } from "../errors/optional-chains.js";
import type { RustProviderReadSelection } from "./provider-forms.js";
import { rustSourceCallBorrowedReturn } from "../callables/ownership/source-input-lifetimes.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";

export function analyzeRustOptionalChainEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustOptionalChainEmissionProducer, required: RustRequiredRecord[],
  providerReads: readonly RustProviderReadSelection[]): readonly TargetDiagnostic[] {
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
    let loan: RustOptionalChainEmission["loan"];
    const ownership = program.ownership.reads.get(node);
    if (depth === 1 && structuralGuard === undefined && ownership?.source.kind === "borrow" && !ownership.source.mutable &&
      ownership.value.kind === "borrow" && !ownership.value.mutable &&
      rustOptionElementCarrier(fact.resultCarrier) !== undefined && rustTargetTypeRefEquals(fact.sourceGuardCarrier, fact.resultCarrier)) {
      const declaration = sourceEnclosingCallable(node, ast);
      const returned = declaration === undefined ? undefined : program.records.sourceCallableReturn.get(declaration)?.borrowedReturn;
      let binding = program.records.sourceBinding.get(fact.guard)?.sourceDeclaration;
      if (binding !== undefined && ast.is.IsVariableDeclaration(binding) && sourceEnclosingCallable(binding, ast) === declaration) {
        const summary = program.sourceNavigation.declarationUseSummary(binding);
        const initializer = Node_Initializer(ast, binding);
        if (!summary.bindingWritten && !summary.memberWritten && !summary.captured && !summary.exported && initializer !== undefined)
          binding = program.records.sourceBinding.get(initializer)?.sourceDeclaration;
      }
      let physical = returned?.carrier.kind === "reference" && binding === returned.parameter ? returned.carrier : undefined;
      let parameter = physical === undefined ? undefined : returned?.parameter;
      let owner = parameter;
      const called = rustSourceCallBorrowedReturn(fact.guard, ast, program.records);
      if (called?.carrier.kind === "reference" && !called.carrier.mutable) {
        let initializer = node;
        for (let parent = ast.parent(initializer); parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === initializer;
          parent = ast.parent(initializer)) initializer = parent;
        const local = program.records.borrowedInitializer.get(initializer);
        const enclosing = ast.parent(initializer);
        if (enclosing !== undefined && ast.is.IsVariableDeclaration(enclosing) && local?.loan?.declaration === enclosing &&
          local.loan.initializer === initializer && local.loan.guard === fact.guard && local.loan.parameter === called.parameter &&
          local.receiver === called.argument && rustTargetTypeRefEquals(local.loan.returnCarrier, called.carrier) &&
          (program.ownership.reads.get(called.argument)?.readsStorage === true ||
            local.retained.some(value => value.expression === called.argument))) {
          physical = local.loan.resultCarrier;
          parameter = called.parameter;
          owner = called.argument;
        }
      }
      const abiParameter = parameter === undefined ? undefined : program.records.sourceParameterAbi.get(parameter);
      const exactReturn = called?.carrier ?? returned?.carrier;
      const occurrences = program.physicalEmissionContexts.sourceOccurrences.filter(occurrence => occurrence.node === node);
      const occurrence = occurrences.length === 1 ? occurrences[0] : undefined;
      const abi = occurrence?.operation.abi;
      const selected = abi === undefined ? [] : providerReads.filter(selection => selection.node === node && selection.abi === abi);
      const present = selected.length === 1 ? selected[0] : undefined;
      const body = declaration === undefined ? undefined : program.records.callableDeclaration.get(declaration)?.nativeBody;
      const bodies: (true | undefined)[] = body === undefined ? [undefined]
        : program.promiseBodies.objects.has(declaration!) ? [undefined, true] : [true];
      const receiverCarrier = read?.selectedCarrier ?? fact.selectedGuardCarrier;
      if (physical !== undefined && parameter !== undefined && owner !== undefined && !physical.mutable &&
        physical.lifetime !== undefined && exactReturn?.kind === "reference" && !exactReturn.mutable &&
        abiParameter?.mode === "ref" && abiParameter.parameterCarrier.kind === "reference" && !abiParameter.parameterCarrier.mutable &&
        abiParameter.inputLifetime !== undefined && rustLifetimesEqual(exactReturn.lifetime, abiParameter.inputLifetime) &&
        rustTargetTypeRefEquals(physical.referent, fact.resultCarrier) &&
        rustTargetTypeRefEquals(abiParameter.valueCarrier, fact.sourceGuardCarrier) &&
        abi?.target.form === "index" && abi.operationKind === "indexer" && abi.result.kind === "sync" &&
        abi.result.conversion.kind === "identity" && rustTargetTypeRefEquals(abi.result.carrier, fact.innerResultCarrier) &&
        rustTargetTypeRefEquals(abi.result.rawCarrier, fact.innerResultCarrier) &&
        abi.targetReceiver.kind === "input" && abi.targetReceiver.input.source.kind === "receiver" &&
        abi.targetReceiver.input.mode === "ref" && abi.targetReceiver.input.conversion.kind === "identity" &&
        rustTargetTypeRefEquals(abi.targetReceiver.input.sourceCarrier, receiverCarrier) &&
        present !== undefined && present.bodies.length === bodies.length && bodies.every(body =>
          present.bodies.filter(selected => selected.body === body && selected.read === "ref").length === 1)) {
        loan = Object.freeze({ parameter, owner, carrier: physical, abi, bodies: Object.freeze(bodies) });
      } else {
        const missing = physical === undefined || owner === undefined || parameter === undefined ? "completed guard-owner association"
          : exactReturn?.kind !== "reference" || abiParameter?.inputLifetime === undefined ||
            !rustLifetimesEqual(exactReturn.lifetime, abiParameter.inputLifetime) ? "completed parameter lifetime"
          : !rustTargetTypeRefEquals(physical.referent, fact.resultCarrier) ||
            !rustTargetTypeRefEquals(abiParameter.valueCarrier, fact.sourceGuardCarrier) ? "exact input/result carrier correspondence"
          : abi?.target.form !== "index" || abi.targetReceiver.kind !== "input" || abi.targetReceiver.input.mode !== "ref" ||
            !rustTargetTypeRefEquals(abi.targetReceiver.input.sourceCarrier, receiverCarrier) ? "finalized native stored-slot receiver ABI"
          : present === undefined || present.bodies.length !== bodies.length || !bodies.every(body =>
            present.bodies.filter(selected => selected.body === body && selected.read === "ref").length === 1) ? "shared stored read for every physical body"
          : "exact immutable result and stored-slot identity";
        refuse(node, "rust.backend.optional-chain-loan", `A borrowed optional result requires its exact parameter lifetime, retained guard owner and finalized stored-element read in every physical body. Missing: ${missing}.`);
        continue;
      }
    }
    const closure = unit || loan !== undefined || !presentBranchIsPure(node, fact.guard) ? undefined
      : fact.lowering === "map" ? "map" as const : "and_then" as const;
    producer.publish(node, { fact, structuralGuard, unit, closure, loan });
    requireRustRecord(required, "optionalChainEmission", node, "optional-chain", "analysis/operations/optional-chains.ts");
  }
  return Object.freeze(issues);

  // The present branch (everything the chain evaluates after its guard) can run inside a closure when no node in it
  // suspends, yields or carries error effects. Error effects are recorded on the calls and awaits that carry them.
  function presentBranchIsPure(root: Node, guard: Node): boolean {
    if (analyzeRustOptionalChainBodyFallibility({ ast, records: program.records, structural: program.structuralShapes,
      dispatch: program.projectFieldDispatch, definitions: program.typeDefinitions }, root, guard)) return false;
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
