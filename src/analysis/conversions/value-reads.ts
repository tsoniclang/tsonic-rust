import type { Node } from "@tsonic/tsts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustValueReadProducer } from "../program/records/value-read.js";
import { isRustOptionCarrier } from "../../target-model/types/carriers/optional.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../target-model/conversions/contextual.js";

export function analyzeRustValueReads(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustValueReadProducer): void {
  for (const node of nodes) {
    const source = program.records.runtimeCarrier.get(node)?.carrier;
    const flow = program.records.flowReadProjection.get(node);
    const conversion = program.records.conversion.get(node);
    const upcast = program.records.projectUpcast.get(node);
    const lifetime = program.records.callScopedLifetimeReconciliation.get(node);
    const object = program.records.objectReferenceView.get(node);
    const indexed = program.records.indexedFieldKeyArgument.get(node);
    const contextual = program.records.contextualValueConversion.get(node);
    const optional = program.records.optionProjection.get(node);
    const contextualInput = lifetime?.selectedCarrier ?? upcast?.targetCarrier ?? conversion?.convertedType ?? flow?.selectedCarrier ?? source;
    const optionInput = contextual?.targetCarrier ?? indexed?.carrier ?? object?.targetCarrier ?? contextualInput;
    const value = optional?.resultCarrier ?? optionInput;
    if (source === undefined && value === undefined) continue;
    const referenceReborrow = contextual?.conversion.kind === "reference-reborrow" &&
      rustCompilerOwnedContextualConversionMatches(contextual.sourceCarrier, contextual.targetCarrier, contextual.conversion, program.typeDefinitions)
      ? contextual.conversion : undefined;
    producer.publish(node, { source, value, contextualInput, optionInput, referenceReborrow,
      strictEquality: isRustOptionCarrier(source) ? source : optional !== undefined && isRustOptionCarrier(optional.resultCarrier) ? optional.sourceCarrier : value });
  }
}
