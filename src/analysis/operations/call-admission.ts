import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { Node_Expression } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustStringTargetType } from "../../target-model/types/index.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";

export function admitRustCalls(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const { ast } = program.source;
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    if (!ast.is.IsCallExpression(node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact === undefined) continue;
    const result = "resultCarrier" in fact ? fact.resultCarrier : undefined;
    const expected = program.records.optionalChain.get(node)?.resultCarrier ?? result;
    if (expected !== undefined && !rustTargetTypeRefEquals(program.records.runtimeCarrier.get(node)?.carrier, expected))
      refuse(node, "rust.backend.call-result-carrier", "Call runtime carrier conflicts with its finalized selected operation result carrier.");
    const arguments_ = ast.arguments(node);
    const selected = program.records.selectedCall.get(node);
    if (fact.kind === "provider-operation") {
      const callee = Node_Expression(ast, node);
      if (fact.abi.operationKind !== "method" && !(fact.abi.operationKind === "constructor" && callee !== undefined && ast.kindName(callee) === "KindSuperKeyword"))
        refuse(node, "rust.provider.call-kind", `Call expression requires a finalized provider method fact, received '${fact.abi.operationKind}'.`);
      if (arguments_.length !== fact.abi.sourceArguments.length)
        refuse(node, "rust.backend.provider-call-arity", `Provider call has ${arguments_.length} source arguments but its finalized ABI requires ${fact.abi.sourceArguments.length}.`);
      continue;
    }
    if (fact.kind === "default-value") {
      const operation = program.records.selectedOperation.get(node);
      if (!isDenseDataArray(arguments_) || arguments_.length !== 0 || selected === undefined || selected.member.id !== fact.operationId ||
        selected.member.kind !== "method" || selected.member.static !== true || selected.member.parameters.length !== 0 ||
        !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) || selected.member.genericParameters?.length !== 1 ||
        selected.member.genericParameters[0]?.kind !== "type" || selected.targetGenericArguments?.length !== 1 ||
        selected.targetGenericArguments[0]?.kind !== "type" || !rustTargetTypeRefEquals(selected.targetGenericArguments[0].type, fact.resultCarrier) ||
        operation?.operationId !== fact.operationId || operation.operationKind !== "method" || operation.targetOperation !== "Default::default" ||
        !rustTargetTypeRefEquals(operation.resultType, fact.resultCarrier))
        refuse(node, "rust.backend.default-value-selected-signature", "Native default initialization conflicts with its finalized zero-argument Rust Default contract.");
      continue;
    }
    if (fact.kind !== "object-shape-projection") continue;
    const staticCall = fact.sourceValueOrigin.kind === "argument";
    if (staticCall && arguments_[fact.sourceValueOrigin.index] !== fact.sourceValue)
      refuse(node, "rust.backend.object-shape-projection-source", "Closed Object projection source argument conflicts with its finalized origin.");
    const parameters = staticCall ? fact.projection === "has-own" ? [fact.sourceValueCarrier, rustStringTargetType()]
      : fact.projection === "assign" ? [fact.sourceValueCarrier, fact.assignmentSourceCarrier] : [fact.sourceValueCarrier]
      : fact.projection === "has-own" ? [rustStringTargetType()] : [];
    const borrowed = (index: number): boolean => staticCall && (index === 0 || fact.projection === "assign" && index === 1);
    if (selected === undefined || selected.member.id !== fact.operationId || selected.member.kind !== "method" ||
      (selected.member.static === true) !== staticCall || !rustTargetTypeRefEquals(selected.member.returnType, fact.resultCarrier) ||
      parameters.some(carrier => carrier === undefined) || selected.member.parameters.length !== parameters.length ||
      !selected.member.parameters.every((parameter, index) => rustTargetTypeRefEquals(parameter.type, parameters[index]) &&
        parameter.passingMode === (borrowed(index) ? "borrow-shared" : "by-value")) ||
      !staticCall && !rustTargetTypeRefEquals(selected.sourceSelectedReceiverCarrier, fact.sourceValueCarrier))
      refuse(node, "rust.backend.object-shape-projection-selected-signature", "Closed Object projection conflicts with its TSTS-selected target member contract.");
    if (!isDenseDataArray(arguments_) || arguments_.some(argument => argument === undefined) || arguments_.length !== parameters.length ||
      arguments_.some((argument, index) => program.records.argumentPassing.get(argument)?.mode !== (borrowed(index) ? "borrow-shared" : "by-value")))
      refuse(node, "rust.backend.object-shape-projection-arguments", "Closed Object projection source arguments conflict with their finalized passing contracts.");
    if (fact.assignmentSource !== undefined && arguments_[1] !== fact.assignmentSource)
      refuse(node, "rust.backend.object-assign-source", "Closed Object.assign source conflicts with its finalized second argument.");
    if (fact.projection === "has-own" && fact.keyExpression === undefined)
      refuse(node, "rust.backend.object-shape-projection-key", "Closed Object.hasOwn projection has no finalized key expression.");
    if (fact.projection === "assign" && (fact.storage !== "structural-object" || fact.assignmentSourceCarrier === undefined || fact.assignmentFields === undefined))
      refuse(node, "rust.backend.object-assign-source", "Closed Object.assign has no exact generated source object handle.");
  }
  return Object.freeze(issues);
}
