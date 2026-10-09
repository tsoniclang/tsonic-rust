import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustProjectTypePolicy } from "../../target-model/types/project-types.js";
import { isRustClosedValueCarrier } from "../../target-model/types/carriers/closed-value-kind.js";
import { isRustSourceErrorCarrier, isRustRetainedErrorCarrier } from "../../target-model/types/carriers/source-error.js";
import { rustProgramErrorConversionMatches, type RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";
import { rustContextualValueConversionFactKey, rustFlowReadProjectionFactKey, rustTargetOperationFactKey,
  rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey } from "./keys.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustEffectiveValueCarrier, rustValueCarrierBeforeContextualConversion } from "./value-carrier-queries.js";
import { rustFlowReadProjectionMatches } from "./flow-read-projections.js";

export interface RustClosedErrorTransportDemand {
  readonly thrownCarriers: readonly TargetTypeRef[];
  readonly retained: boolean;
  readonly sourceView: boolean;
}

export function rustClosedErrorTransportDemand(
  sourceFile: SourceFile, ast: AstReader, facts: RustPlanQueries,
  definitions: RustTypeDefinitions, projectTypes: RustProjectTypePolicy,
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
    if (seen.has(node) || entry.depth > 2048) return undefined;
    seen.add(node);
    const contextual = facts.get(node, rustContextualValueConversionFactKey);
    if (contextual?.conversion.kind === "program-error") {
      const source = rustValueCarrierBeforeContextualConversion(facts, node);
      if (source !== undefined && rustTargetTypeRefEquals(source, contextual.sourceCarrier) &&
        rustProgramErrorConversionMatches(contextual.conversion, source, contextual.targetCarrier, definitions)) {
        collect(source, contextual.conversion.route);
      }
    }
    const projection = facts.get(node, rustFlowReadProjectionFactKey);
    for (const carrier of [facts.get(node, rustRuntimeCarrierKey)?.carrier,
      facts.get(node, rustSourceCallableReturnFactKey)?.returnCarrier,
      facts.get(node, rustSourceParameterAbiFactKey)?.parameterCarrier,
      projection !== undefined && rustFlowReadProjectionMatches(projection, projectTypes, definitions)
        ? projection.selectedCarrier : undefined]) {
      if (carrier !== undefined && !inspect(carrier)) return undefined;
    }
    if (projection?.kind === "builtin-error" && isRustClosedValueCarrier(projection.sourceCarrier) &&
      (isRustSourceErrorCarrier(projection.selectedCarrier) || isRustRetainedErrorCarrier(projection.selectedCarrier)) &&
      rustFlowReadProjectionMatches(projection, projectTypes, definitions)) {
      retained = true;
    }
    const operation = facts.get(node, rustTargetOperationFactKey);
    if (ast.kindName(node) === "KindThrowStatement" && operation?.kind === "throw-op" &&
      operation.error.kind === "conversion" && operation.error.expression === Node_Expression(ast, node)) {
      const conversion = operation.error.conversion;
      const carrier = rustEffectiveValueCarrier(facts, operation.error.expression);
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
