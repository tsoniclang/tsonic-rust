import type { RustClosedErrorTransportDemand } from "../../target-model/records/errors/closed-error-demand.js";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression, TryStatement_CatchClause,
  TryStatement_TryBlock } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustProgramErrorConversionMatches } from "../../policy/conversions/program-error.js";
import type { RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";

import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "../conversions/value-carrier-queries.js";
import { rustFlowReadProjectionMatches } from "../control-flow/flow-read-projections.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustJsRejectionErrorIdentity } from "../../target-model/records/errors/error-effects.js";
import type { RustErrorEffectsFact } from "../../target-model/records/errors/error-effects.js";

export function rustClosedErrorTransportDemand(
  sourceFile: SourceFile, ast: AstReader, records: RustProgramRecords,
  definitions: RustTypeDefinitions, projectTypes: RustProjectTypePolicy,
  effectsFor: (node: Node) => RustErrorEffectsFact | undefined,
  isNativeNode: (node: Node) => boolean,
): RustClosedErrorTransportDemand | undefined {
  const carriers: TargetTypeRef[] = [];
  let retained = false;
  let sourceView = false;
  const collect = (carrier: TargetTypeRef, route: RustProgramErrorRoute): void => {
    if (route.kind === "closed-admission") carrier = definitions.closedValueCarrier;
    if ((route.kind === "closed" || route.kind === "closed-admission") &&
      !carriers.some(previous => rustTargetTypeRefEquals(previous, carrier))) {
      carriers.push(carrier);
      retained = true;
    } else if (route.kind === "retained") {
      retained = true;
    } else if (route.kind === "union") {
      for (const arm of route.arms) collect(arm.carrier, arm.route);
    }
  };
  const collectAdapterErrors = (conversion: RustCallableConversion, depth: number): void => {
    if (depth > 128) return;
    if (conversion.error?.kind === "program-error") collect(conversion.error.source, conversion.error.route);
    for (const value of [...conversion.parameters, conversion.result]) {
      if (value.kind !== "value") continue;
      if (value.conversion.kind === "callable-adapter") collectAdapterErrors(value.conversion, depth + 1);
      else if (value.conversion.kind === "program-error") collect(value.conversion.source, value.conversion.route);
    }
  };
  const seen = new Set<Node>();
  const pending = [{ node: sourceFile as Node, depth: 0 }];
  let rows = 1;
  const inspected = new Set<TargetTypeRef>();
  const inspect = (carrier: TargetTypeRef): boolean => {
    if (inspected.has(carrier)) return true;
    if (++rows > 1_048_576) return false;
    const pendingTypes = [{ carrier, depth: 0 }];
    while (pendingTypes.length !== 0) {
      const current = pendingTypes.pop()!;
      if (current.depth > 2048) return false;
      if (inspected.has(current.carrier)) continue;
      inspected.add(current.carrier);
      sourceView ||= isRustSourceErrorCarrier(current.carrier);
      for (const child of rustTargetTypeChildren(current.carrier)) {
        if (++rows > 1_048_576) return false;
        pendingTypes.push({ carrier: child, depth: current.depth + 1 });
      }
    }
    return true;
  };
  while (pending.length !== 0) {
    const entry = pending.pop()!;
    const node = entry.node;
    if (!isNativeNode(node)) continue;
    if (seen.has(node) || entry.depth > 2048) return undefined;
    seen.add(node);
    const contextual = records.contextualValueConversion.get(node);
    if (contextual?.conversion.kind === "program-error") {
      const source = rustValueCarrierBeforeContextualConversion(records, node);
      if (source !== undefined && rustTargetTypeRefEquals(source, contextual.sourceCarrier) &&
        rustProgramErrorConversionMatches(contextual.conversion, source, contextual.targetCarrier, definitions)) {
        collect(source, contextual.conversion.route);
      }
    }
    // A callable adapter converts its invoked callable's error (a Promise resolver's JsValue) into the target callable's
    // program error; a closed route there is a closed thrown value like any other and needs its payload transport.
    if (contextual?.conversion.kind === "callable-adapter") collectAdapterErrors(contextual.conversion, 0);
    const projection = records.flowReadProjection.get(node);
    for (const carrier of [records.runtimeCarrier.get(node)?.carrier,
      records.sourceCallableReturn.get(node)?.returnCarrier,
      records.sourceParameterAbi.get(node)?.parameterCarrier,
      projection !== undefined && rustFlowReadProjectionMatches(projection, projectTypes, definitions)
        ? projection.selectedCarrier : undefined]) {
      if (carrier !== undefined && !inspect(carrier)) return undefined;
    }
    if (projection?.kind === "builtin-error" && isRustClosedValueCarrier(projection.sourceCarrier) &&
      (isRustSourceErrorCarrier(projection.selectedCarrier) || isRustRetainedErrorCarrier(projection.selectedCarrier)) &&
      rustFlowReadProjectionMatches(projection, projectTypes, definitions)) {
      retained = true;
    }
    const operation = records.targetOperation.get(node);
    if (ast.kindName(node) === "KindTryStatement" && TryStatement_CatchClause(ast, node) !== undefined) {
      const body = TryStatement_TryBlock(ast, node);
      const effects = body === undefined ? undefined : effectsFor(body);
      if (effects === undefined) return undefined;
      if (effects.nativeErrors.some(error => error.identity === rustJsRejectionErrorIdentity &&
        rustTargetTypeRefEquals(error.errorType, rustJsValueTargetType()))) collect(rustJsValueTargetType(), { kind: "closed" });
    }
    if (ast.kindName(node) === "KindThrowStatement" && operation?.kind === "throw-op" &&
      operation.error.kind === "conversion" && operation.error.expression === Node_Expression(ast, node)) {
      const conversion = operation.error.conversion;
      const carrier = rustEffectiveValueCarrier(records, operation.error.expression);
      if (carrier !== undefined && rustProgramErrorConversionMatches(conversion, carrier, conversion.target, definitions)) {
        collect(conversion.source, conversion.route);
      }
    }
    let malformed = false;
    ast.forEachChild(node, child => {
      if (child === undefined || ++rows > 1_048_576) malformed = true;
      else pending.push({ node: child, depth: entry.depth + 1 });
    });
    if (malformed) return undefined;
  }
  return Object.freeze({ thrownCarriers: Object.freeze(carriers), retained, sourceView });
}
