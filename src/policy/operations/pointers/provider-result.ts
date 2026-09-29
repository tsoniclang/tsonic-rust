import { selectTsonicProviderPointerResult } from "@tsonic/source-core/facts";
import type { ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import { resolveRustTargetTypeRef } from "../../types/resolution.js";
import type { RustTargetTypeResolutionContext, RustTargetTypeResolutionOptions } from "../../types/resolution.js";
import {
  rustJsArrayTargetType,
  rustSourceLocationTargetType,
  rustOptionTargetType,
  rustRawPointerTargetType,
  rustSourcePrimitiveTargetType,
  rustTupleTargetType,
  rustVecTargetType,
} from "../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProviderGenericParameter } from "../../../target-model/operations/model.js";

export function selectRustProviderPointerResult(
  source: ResolvedSourceCallInfo,
  context: RustTargetTypeResolutionContext,
  options: RustTargetTypeResolutionOptions,
  parameters: readonly RustProviderGenericParameter[],
  typeArguments: ReadonlyMap<string, TargetTypeRef>,
) {
  return selectTsonicProviderPointerResult<TargetTypeRef>(source, context.ast, context.currentSemantics, context.source.sourceFacts, {
    primitive: rustSourcePrimitiveTargetType,
    raw: rustRawPointerTargetType,
    pointer: rustSourceLocationTargetType,
    optional: rustOptionTargetType,
    array: element => options.jsEnabled ? rustJsArrayTargetType(element) : rustVecTargetType(element),
    tuple: rustTupleTargetType,
    typeParameter: parameter => {
      const binding = parameters.find(value => value.sourceName === parameter.parameter.name);
      return binding?.kind === "type" ? typeArguments.get(binding.targetIdentity) : undefined;
    },
    sourceType: (type, syntax) => resolveRustTargetTypeRef(syntax ?? type, context, options),
  });
}
