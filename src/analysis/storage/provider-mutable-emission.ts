import type { Node } from "@tsonic/tsts";
import { Node_Expression, ElementAccessExpression_ArgumentExpression, type SourceExpressionEffects } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProviderEvaluationProducer } from "../program/records/native/provider-evaluation.js";
import type { RustMutableProviderStorage } from "../../target-model/records/native/provider-evaluation.js";
import { rustTargetOperationIsDirectLocation } from "../../policy/operations/members/native-contracts.js";
import { rustNativeStorageRoot } from "./native-paths.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import { selectRustProviderMutableInputs } from "./provider-mutable-inputs.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustProviderMutableEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustProviderEvaluationProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const context = { ast, records: program.records, navigation: program.sourceNavigation };
  const issues: TargetDiagnostic[] = [];
  const computed = new Map<Node, SourceExpressionEffects>();
  const none: SourceExpressionEffects = Object.freeze({ invokes: false, mutates: false, suspends: false, mayThrow: false });
  const effects = (node: Node): SourceExpressionEffects => {
    const existing = computed.get(node);
    if (existing !== undefined) return existing;
    const kind = ast.kindName(node);
    const operation = program.records.targetOperation.get(node);
    const receiver = Node_Expression(ast, node);
    let selected: SourceExpressionEffects;
    if (kind === "KindIdentifier" || kind === "KindThisExpression" || kind === "KindThisKeyword") selected = none;
    else if (kind === "KindParenthesizedExpression" && receiver !== undefined) selected = effects(receiver);
    else if (kind === "KindPropertyAccessExpression" && receiver !== undefined && (rustTargetOperationIsDirectLocation(operation) ||
      operation?.kind === "source-field" && operation.valueSemantics.kind === "stored" && operation.dispatch === undefined)) selected = effects(receiver);
    else if (kind === "KindElementAccessExpression" && receiver !== undefined && rustTargetOperationIsDirectLocation(operation)) {
      const index = ElementAccessExpression_ArgumentExpression(ast, node);
      const left = effects(receiver);
      const right = program.sourceNavigation.expressionEffects(index ?? node);
      selected = Object.freeze({ invokes: left.invokes || right.invokes, mutates: left.mutates || right.mutates,
        suspends: left.suspends || right.suspends, mayThrow: left.mayThrow || right.mayThrow });
    } else selected = program.sourceNavigation.expressionEffects(node);
    computed.set(node, selected);
    producer.effects(node, selected);
    return selected;
  };
  for (const node of nodes) if (!rustProgramNodeIsOutsideNativeCode(program, node)) effects(node);
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences) {
    const mutable = occurrence.inputs.filter(selected => selected.input.mode === "mut-ref");
    if (mutable.length === 0) { producer.mutable(occurrence.node, occurrence.operation, Object.freeze([])); continue; }
    const proof = selectRustProviderMutableInputs(occurrence.node, occurrence.operation,
      { ...context, statementCompletions: { runtimeSetter: program.records.runtimeSetter } });
    if (proof?.kind === "rejected") {
      issues.push(Object.freeze({ code: "RUST_PROVIDER_MUTABLE_INPUT_NOT_DISJOINT", category: "error", source: "tsonic-rust",
        sourceNode: proof.node, message: proof.reason, evidence: Object.freeze(["target.capability=rust.native-provider.disjoint-mutable-storage"]) }));
      continue;
    }
    if (proof?.kind !== "proved" || proof.operation !== occurrence.operation || proof.inputs.length !== mutable.length)
      failTargetAnalysisInvariant("tsonic-rust", "Mutable provider lowering requires its exact sealed source-storage admission proof.", occurrence.node);
    producer.mutable(occurrence.node, occurrence.operation, proof.inputs.map(selected => {
      if (!mutable.some(candidate => candidate.input === selected.input && candidate.slot.key === selected.key))
        failTargetAnalysisInvariant("tsonic-rust", "Mutable provider admission must retain its exact physical source operand.", selected.node);
      return Object.freeze({ ...selected, storage: classify(selected.node) });
    }));
  }
  return Object.freeze(issues);

  function classify(node: Node): RustMutableProviderStorage {
    const operation = program.records.targetOperation.get(node);
    const rootDeclaration = rustNativeStorageRoot(node, context);
    if (operation?.kind === "source-field" && operation.storage === "project-object" &&
      operation.valueSemantics.kind === "stored" && operation.dispatch === undefined) {
      const definition = program.projectTypes.definitionForCarrier(operation.receiverCarrier);
      const representation = definition === undefined ? undefined : program.objectRepresentations.representationFor(definition);
      const path = program.records.storedField.get("project-object", operation.receiverCarrier, operation.storageIndex)?.path;
      const receiver = Node_Expression(ast, node);
      if (representation !== undefined && representation.kind !== "value" && representation.kind !== "shared-immutable" && path !== undefined && receiver !== undefined)
        return Object.freeze({ kind: "project-field", receiver, path, rootDeclaration: rustNativeStorageRoot(receiver, context) });
      if (representation?.kind === "value") return Object.freeze({ kind: "direct", rootDeclaration });
    }
    const binding = program.records.sourceBinding.get(node);
    const name = binding === undefined ? undefined : program.records.sourceBindingEmission.get(binding.sourceDeclaration);
    const file = ast.getSourceFile(node);
    const directName = ast.is.IsIdentifier(node) && name !== undefined && isValidRustIdentifier(name.name) &&
      (name.scope === "lexical" || file !== undefined && name.fileName === ast.getFileName(file));
    const kind = ast.kindName(node);
    return Object.freeze({ kind: directName || kind === "KindThisExpression" || kind === "KindThisKeyword" || rustTargetOperationIsDirectLocation(operation) ? "direct" : "owned",
      rootDeclaration });
  }
}
