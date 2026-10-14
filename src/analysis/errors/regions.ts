import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetDiagnostic, TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustErrorJoinDeclaration, RustErrorRegionRecords, RustErrorRegionSelection } from "../../target-model/records/error-regions.js";
import type { RustNamePlan } from "../../target-model/names/model.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";
import type { RustCallableConversion } from "../../target-model/conversions/callable.js";
import { rustCallableConversionErrorArities } from "../../target-model/conversions/callable-physical.js";
import type { RustCallableValueAdapter } from "../../target-model/records/callable-adapters.js";
import type { RustNativeCallableProducer } from "../callables/native-producers.js";
import type { RustCallableValuePlan } from "../callables/value-plan.js";
import type { RustProducerErrorReference } from "../../target-model/types/carriers/producer-errors.js";
import { rustProducerErrorTargetType } from "../../target-model/types/carriers/producer-errors.js";
import { bindRustGenericArguments } from "../../target-model/types/carriers/generic-argument-bindings.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { rustNativeCallableCompletion } from "../../target-model/types/callable-completions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { normalizeRustErrorType, selectRustPhysicalProgramErrorOwner, type RustErrorTypeContext } from "../program/error-types.js";

export function analyzeRustErrorRegions(input: RustErrorTypeContext & {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly records: RustProgramRecords;
  readonly names: RustNamePlan;
  readonly callables: Pick<RustCallableValuePlan, "native" | "nativeGenericProducers">;
}): TargetStageResult<RustErrorRegionRecords> {
  const regions = new Map<Node, RustErrorRegionSelection>();
  const declarations = new Map<string, readonly RustErrorJoinDeclaration[]>();
  const producers = new Map<string, {
    readonly producer: RustNativeCallableProducer;
    readonly channels: ReadonlyMap<"invoke" | number, TargetTypeRef>;
  }>();
  const diagnostics: TargetDiagnostic[] = [];
  const reject = (node: Node, message: string): void => {
    diagnostics.push({ code: "RUST_ERROR_REGION_UNRESOLVED", category: "error", source: "tsonic-rust",
      sourceNode: node, message, evidence: ["target.capability=rust.analysis.error-regions"] });
  };
  for (const producer of input.producers.producers) {
    const asynchronous = input.records.asyncFunction.get(producer.declaration);
    const result = asynchronous?.futureCarrier ?? input.records.sourceCallableReturn.get(producer.declaration)?.returnCarrier;
    const completion = result === undefined ? undefined : rustNativeCallableCompletion(result, input.definitions);
    const channels = new Map<"invoke" | number, TargetTypeRef>();
    for (const channel of ["invoke" as const, ...Array.from({ length: completion?.futures.length ?? 0 }, (_value, index) => index)]) {
      const carrier = normalizeRustErrorType(rustProducerErrorTargetType({ identity: producer.identity,
        fileName: producer.fileName, channel, genericArguments: producer.environment }), input);
      if (carrier !== undefined) channels.set(channel, carrier);
    }
    producers.set(producer.identity, Object.freeze({ producer, channels }));
  }
  for (const file of input.sourceFiles) {
    const fileName = input.ast.getFileName(file);
    const usedNames = new Set<string>();
    const arities = new Set<number>();
    const clonedArities = new Set<number>();
    const registerConversion = (node: Node, conversion: RustCallableConversion): void => {
      const selected = rustCallableConversionErrorArities(conversion, input.definitions);
      if (selected === undefined) reject(node, "Callable conversion error joins have no exact physical channels.");
      else for (const arity of selected) arities.add(arity);
    };
    const registerAdapter = (node: Node, adapter: RustCallableValueAdapter, depth = 0): void => {
      if (depth > 128) { reject(node, "Callable error joins exceed their bounded adapter depth."); return; }
      if (adapter.kind === "conversion" && adapter.conversion.kind === "callable-adapter") registerConversion(node, adapter.conversion);
      else if (adapter.kind === "option-map" || adapter.kind === "option-some") registerAdapter(node, adapter.element, depth + 1);
    };
    const visit = (node: Node): void => {
      for (const name of [input.names.nameForDeclaration(node), input.names.functionNameForDeclaration(node),
        input.names.callableValueNameForDeclaration(node)]) if (name !== undefined) usedNames.add(name);
      const effects = input.records.errorEffects.get(node);
      if (effects !== undefined) {
        const owner = effects.localErrors ? selectRustPhysicalProgramErrorOwner(node, input) : undefined;
        const sources = effects.nativeErrors.map((source, index) => {
          const errorType = normalizeRustErrorType(source.errorType, input, node);
          return errorType === undefined ? undefined : Object.freeze({ identity: source.identity,
            variant: `Error${index + (effects.localErrors ? 1 : 0)}`, errorType });
        });
        if (effects.localErrors && owner === undefined || sources.some(source => source === undefined)) {
          reject(node, "An error region has no exact physical package owner or native payload carrier.");
        } else {
          regions.set(node, Object.freeze({ localOwner: owner,
            sources: Object.freeze(sources as NonNullable<typeof sources[number]>[]) }));
        }
        if (effects.nativeErrors.length > 0) {
          const arity = effects.nativeErrors.length + (effects.localErrors ? 1 : 0);
          if (arity > 1) arities.add(arity);
          if (input.records.asyncFunction.get(node)?.kind === "js-promise") clonedArities.add(arity);
        }
      }
      const conversion = input.records.contextualValueConversion.get(node)?.conversion;
      if (conversion?.kind === "callable-adapter") registerConversion(node, conversion);
      for (const adapter of input.records.projectCallableAdapters.get(node) ?? []) {
        registerAdapter(node, adapter.resultAdapter);
        for (const parameter of adapter.parameterAdapters) {
          if (parameter.kind === "runtime-value" || parameter.kind === "logical-value" || parameter.kind === "rest-element")
            registerAdapter(node, parameter.adapter);
          else if (parameter.kind === "rest") for (const segment of parameter.segments) registerAdapter(node, segment.adapter);
        }
      }
      input.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(file);
    const producerArities = input.callables.nativeGenericProducers.errorAritiesFor(fileName);
    if (producerArities === undefined) reject(file, "Native generic producers have no sealed exact error channels.");
    else for (const arity of producerArities) arities.add(arity);
    for (const selected of input.callables.native.inputs) {
      if (selected.protocol.ownerFileName !== fileName) continue;
      usedNames.add(selected.protocol.targetName);
      if (selected.protocol.boundProducerName !== undefined) usedNames.add(selected.protocol.boundProducerName);
    }
    declarations.set(fileName, Object.freeze([...arities].sort((left, right) => left - right).map(arity =>
      Object.freeze({ name: allocateRustGeneratedName(usedNames, `NativeErrors${arity}`), arity,
        clone: clonedArities.has(arity) }))));
  }
  const empty: readonly RustErrorJoinDeclaration[] = Object.freeze([]);
  return diagnostics.length > 0 ? rejectedTargetStage(diagnostics) : resolvedTargetStage(Object.freeze({
    get: (declaration: Node) => regions.get(declaration),
    declarationsFor: (fileName: string) => declarations.get(fileName) ?? empty,
    producerError(reference: RustProducerErrorReference): TargetTypeRef | undefined {
      const selected = producers.get(reference.identity);
      if (selected === undefined || selected.producer.fileName !== reference.fileName) return undefined;
      const carrier = selected.channels.get(reference.channel);
      const bindings = bindRustGenericArguments(selected.producer.environment, reference.genericArguments);
      return carrier === undefined || bindings === undefined ? undefined
        : substituteRustTargetGenerics(carrier, bindings.types, bindings.lifetimes, bindings.consts);
    },
  }));
}
