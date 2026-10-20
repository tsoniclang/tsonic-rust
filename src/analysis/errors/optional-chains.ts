import type { AstReader, Node } from "@tsonic/tsts";
import { forEachSourceImmediateEvaluationChild } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import { rustTargetOperationIsFallible } from "../operations/target-operation.js";
import { rustContextualValueConversionIsFallible } from "../../target-model/conversions/contextual.js";

export function analyzeRustOptionalChainBodyFallibility(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly structural: Parameters<typeof rustTargetOperationIsFallible>[1];
  readonly dispatch: Parameters<typeof rustTargetOperationIsFallible>[2];
  readonly frozen: Parameters<typeof rustTargetOperationIsFallible>[3];
  readonly definitions: Parameters<typeof rustTargetOperationIsFallible>[4];
}, expression: Node, guard: Node): boolean {
  const visit = (node: Node): boolean => {
    if (node === guard) return false;
    const effects = input.records.errorEffects.get(node);
    if (effects?.localErrors === true || (effects?.nativeErrors.length ?? 0) !== 0 ||
      input.records.sourceCallEffects.get(node)?.invocation === "fallible" || input.records.sourceAccessorEffects.get(node)?.read === "fallible" ||
      rustTargetOperationIsFallible(input.records.targetOperation.get(node), input.structural, input.dispatch, input.frozen, input.definitions) ||
      rustContextualValueConversionIsFallible(input.records.contextualValueConversion.get(node)?.conversion, input.definitions)) return true;
    let fallible = false;
    forEachSourceImmediateEvaluationChild(input.ast, node, child => { if (!fallible) fallible = visit(child); });
    return fallible;
  };
  return visit(expression);
}
