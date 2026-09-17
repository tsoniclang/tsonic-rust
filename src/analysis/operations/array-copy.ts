import type { RustCheckedCallSelectionInput, RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { JsArrayCopyMode } from "../../policy/operations/js-surface/model.js";
import type { RustOperationsProviderOptions } from "./provider/model.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { resolveRustExactNullishValueCarrier } from "../../policy/types/resolution/target.js";
import {
  rustJsArrayTargetId, rustOptionElementCarrier, rustUndefinedTargetType,
} from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isRustNumberArrayUnion } from "../../target-model/types/carriers/array-unions.js";

export function selectRustArrayCopyMode(
  request: RustCheckedCallSelectionInput,
  context: RustOperationPolicyContext,
  options: RustOperationsProviderOptions,
): JsArrayCopyMode | undefined {
  if (request.source.sourceArguments.length !== 1 ||
    request.source.sourceSelectedMethodTypeArguments?.length !== 1) return undefined;
  const expression = request.source.sourceArguments[0]!.expression;
  const source = resolveRustTargetTypeRef(expression, context, options);
  if (isRustNumberArrayUnion(source, context.typeDefinitions)) return options.arrayDensity.array(expression) ? "dense" : undefined;
  if (source?.kind !== "target-named" || source.id !== rustJsArrayTargetId) return undefined;
  if (options.arrayDensity.array(expression)) return "dense";
  const selection = request.source.sourceSelectedMethodTypeArguments[0]!;
  const element = selection.selectedType;
  const carrier = resolveRustTargetTypeRef(selection.explicitTypeNode ?? element, context, options);
  if (carrier === undefined) return undefined;
  const queries = context.currentSemantics;
  const members = queries.types.isUnion(element) ? queries.types.unionOrIntersectionTypes(element) : [element];
  const absent = members.filter(member => queries.types.isNullish(member));
  if (absent.length !== 1) return undefined;
  const absence = resolveRustExactNullishValueCarrier(absent[0]!, queries);
  if (absence === undefined || !rustTargetTypeRefEquals(absence, rustUndefinedTargetType())) return undefined;
  if (rustTargetTypeRefEquals(carrier, rustUndefinedTargetType())) return "undefined";
  return rustOptionElementCarrier(carrier) === undefined ? undefined : "optional-undefined";
}
