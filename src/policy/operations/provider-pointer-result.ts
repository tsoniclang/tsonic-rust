import { selectTsonicProviderPointerResult } from "@tsonic/source-core/facts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import { resolveRustTargetTypeRef } from "../types/resolution.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../types/resolution.js";
import {
  rustJsArrayTargetType,
  rustLocationTargetType,
  rustOptionTargetType,
  rustRawPointerTargetType,
  rustSourcePrimitiveTargetType,
  rustTupleTargetType,
  rustVecTargetType,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function selectRustProviderPointerResult(
  source: ResolvedSourceCallInfo,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  typeArguments: ReadonlyMap<string, TargetTypeRef>,
) {
  return selectTsonicProviderPointerResult<TargetTypeRef>(source, context.ast, context.currentSemantics, context.source.sourceFacts, {
    primitive: rustSourcePrimitiveTargetType,
    raw: rustRawPointerTargetType,
    pointer: rustLocationTargetType,
    optional: rustOptionTargetType,
    array: element => options.jsEnabled ? rustJsArrayTargetType(element) : rustVecTargetType(element),
    tuple: rustTupleTargetType,
    typeParameter: parameter => typeArguments.get(parameter.parameter.name),
    sourceType: (type, syntax) => resolveRustTargetTypeRef(syntax ?? type, context, options),
  });
}
