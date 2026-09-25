import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Type } from "@tsonic/target-api/source";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { readRustLanguageCall, type RustLanguageCall } from "./native-language-call.js";
import { rustSourceOperationExportIds, rustSourceOperationSignatureIds } from "../../source/semantics/identity.js";
import { resolveExpressionCarrier } from "./carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustNamedTypeCarrierValue, rustTargetGenericTypeArguments } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustAsyncFunctionFactKey, rustSourceCallableReturnFactKey } from "../facts/keys.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";

interface RustNativeControl extends RustLanguageCall {
  readonly operation: "range" | "propagate";
}

export function readRustNativeControl(walk: RustFactWalk, expression: Node): RustNativeControl | undefined {
  const call = readRustLanguageCall(walk, expression);
  if (call === undefined) return undefined;
  for (const operation of ["range", "propagate"] as const) {
    if (call.declaration.exportId === rustSourceOperationExportIds[operation] &&
      call.declaration.signatureId === rustSourceOperationSignatureIds[operation]) {
      return { ...call, operation };
    }
  }
  return undefined;
}

export function resolveRustNativeControl(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  control: NonNullable<ReturnType<typeof readRustNativeControl>>,
) {
  const resolution = rustResolutionContext(walk, expression);
  const selectedResult = resolveRustTargetTypeRef(
    control.selection.sourceResultType, resolution, walk.operationOptions);
  const operands = control.selection.sourceArguments;
  const carriers = operands.map(operand => resolveExpressionCarrier(
    walk, operand.expression, sourceFile,
    resolveRustTargetTypeRef(operand.type, resolution, walk.operationOptions)));
  if (control.operation === "range") {
    const native = rustNamedTypeCarrierValue(selectedResult);
    const element = native === undefined ? undefined : rustTargetGenericTypeArguments(native.genericArguments)[0];
    if (selectedResult !== undefined && native !== undefined && element !== undefined &&
      operands.length === 2 && carriers.every(carrier => rustTargetTypeRefEquals(carrier, element))) {
      setRustOperationFact(walk, expression, {
        kind: "native-range", operationId: "tsonic.rust.range",
        operands: operands.map(operand => operand.expression), elementCarrier: element,
        resultCarrier: selectedResult,
      });
      return { carrier: setCarrierFact(walk, expression, selectedResult) };
    }
  } else {
    const declaration = walk.currentCallableDeclaration;
    const returnCarrier = declaration === undefined ? undefined :
      walk.context.facts.get(declaration, rustAsyncFunctionFactKey)?.outputCarrier ??
      walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
      resolveRustTargetTypeRef(Node_Type(walk.context.ast, declaration), resolution, walk.operationOptions);
    const operandCarrier = carriers[0];
    const operand = rustNamedTypeCarrierValue(operandCarrier);
    const target = rustNamedTypeCarrierValue(returnCarrier);
    const argumentsList = operand === undefined ? [] : rustTargetGenericTypeArguments(operand.genericArguments);
    const targetArguments = target === undefined ? [] : rustTargetGenericTypeArguments(target.genericArguments);
    if (selectedResult !== undefined && operandCarrier !== undefined && returnCarrier !== undefined && declaration !== undefined &&
      operands.length === 1 && operand !== undefined && target !== undefined && operand.id === target.id &&
      argumentsList.length === 2 && targetArguments.length === 2 &&
      rustTargetTypeRefEquals(selectedResult, argumentsList[0])) {
      setRustOperationFact(walk, expression, {
        kind: "native-propagation", operationId: "tsonic.rust.propagate",
        callableDeclaration: declaration, callableReturnCarrier: returnCarrier,
        operandExpression: operands[0]!.expression, operandCarrier,
        operandErrorCarrier: argumentsList[1]!, resultErrorCarrier: targetArguments[1]!,
        resultCarrier: selectedResult,
      });
      return { carrier: setCarrierFact(walk, expression, selectedResult) };
    }
  }
  appendRustDiagnostic(walk, "RUST_NATIVE_CONTROL_CONTRACT_REQUIRED",
    control.operation === "range"
      ? "Native range requires the checked Range type and two exact element carriers."
      : "Native propagation requires an exact Result operand inside a Result-returning callable.",
    expression, []);
  return {};
}
