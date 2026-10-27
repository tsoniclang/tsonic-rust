import type { AstReader, Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { sourceCallableValueParameters, type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustLifetimeIndex } from "../../../target-model/lifetimes/index.js";
import { rustLifetimeKey } from "../../../target-model/lifetimes/index.js";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import type { RustNativeCallableGenericHeader } from "../../../target-model/records/native/native-generics.js";
import type { RustNativeCallableProducerPlan } from "../../../target-model/records/native/native-producers.js";
import type { RustNativeCallableInputPlan } from "../native/native-inputs.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import { rustProgramErrorTargetType } from "../../../target-model/types/carriers/js.js";
import { selectRustNativeFutureEnvironmentRetention } from "../../../policy/ownership/retained-storage.js";
import type { RustNativeStorageConstruction } from "../storage/native-storage.js";
import { rustCallableImplicitLifetimeParameters } from "../ownership/source-input-lifetimes.js";
import { emissionDiagnostic } from "./emission-contexts.js";

export function selectRustCallableEntryGenerics(input: {
  readonly source: Pick<TargetSourceProgram, "semantics">;
  readonly ast: AstReader;
  readonly lifetimes: RustLifetimeIndex;
  readonly records: RustProgramRecords;
  readonly nativeStorage: Pick<RustNativeStorageConstruction, "futureEnvironmentFor" | "prepareReturn" | "parameterFor">;
  readonly nativeProducers: RustNativeCallableProducerPlan;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "capturesFor">;
}, declaration: Node): TargetStageResult<RustNativeCallableGenericHeader> {
  const parameters = input.ast.typeParameters(declaration);
  const sourceContract = parameters.length === 0 ? Object.freeze({ declaration, parameters: Object.freeze([]) })
    : input.lifetimes.contractFor(declaration);
  if (parameters.some(parameter => parameter === undefined) || sourceContract === undefined ||
    sourceContract.parameters.length !== parameters.length || sourceContract.parameters.some((parameter, index) => parameter.declaration !== parameters[index]))
    failTargetAnalysisInvariant("tsonic-rust", "An admitted native callable requires its exact completed source generic contract.", declaration);
  if (sourceContract.parameters.some(parameter => parameter.kind === "type" && !isValidRustIdentifier(parameter.targetName)))
    return rejectedTargetStage([{ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: declaration,
      message: "Callable type parameters require exact valid Rust target names.", evidence: ["target.capability=rust.backend.generics"] }]);
  const environment = input.nativeStorage.futureEnvironmentFor(declaration);
  if (environment.kind === "unresolved") return rejectedTargetStage([emissionDiagnostic(declaration, environment.reason)]);
  const retained = input.records.retainedEnvironment.get(declaration);
  let implicitLifetimes = rustCallableImplicitLifetimeParameters(declaration, input.ast, input.records);
  let retention: RustNativeCallableGenericHeader["retention"];
  if (retained !== undefined) {
    const carriers: TargetTypeRef[] = [];
    for (const selected of retained.inputs) {
      if (selected.kind === "native-task-scope") {
        const task = input.records.nativeTaskUse.get(declaration);
        if (task?.kind !== "owner") failTargetAnalysisInvariant("tsonic-rust", "An admitted retained task scope requires its exact selected physical input.", declaration);
        carriers.push(task.inputCarrier);
        continue;
      }
      const parameter = selected.declaration;
      const physical = input.nativeStorage.parameterFor(parameter);
      if (input.records.sourceParameterAbi.get(parameter) === undefined || physical.kind === "unresolved")
        failTargetAnalysisInvariant("tsonic-rust", "An admitted retained callable requires its exact native parameter storage.", parameter);
      carriers.push(physical.carrier);
    }
    const source = [...carriers];
    const body = [...carriers];
    const asynchronous = input.records.asyncFunction.get(declaration);
    const generator = input.records.generator.get(declaration);
    if (asynchronous?.kind === "js-promise") {
      const output = input.nativeStorage.prepareReturn(declaration);
      const sourceError = input.nativeProducers.errorFor(declaration, 0);
      const bodyError = input.nativeProducers.errorFor(declaration, "body");
      if (output.kind === "unresolved" || sourceError === undefined || bodyError === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted retained Promise requires its exact native result and rejection carriers.", declaration);
      source.push(output.carrier, sourceError);
      body.push(output.carrier, bodyError);
    } else if (generator !== undefined) {
      source.push(generator.yieldType, generator.returnType, generator.nextType);
      body.push(generator.yieldType, generator.returnType, generator.nextType);
    }
    let retainEnvironment = true;
    if (asynchronous?.kind === "native-future") {
      const parameters = sourceCallableValueParameters(input.ast, declaration, input.source.semantics.forNode(declaration));
      if (parameters === undefined || parameters.some(parameter => parameter === undefined))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native Future requires its complete checked value parameter inventory.", declaration);
      const physicalInputs = parameters.map(parameter => input.nativeStorage.parameterFor(parameter));
      const output = input.nativeStorage.prepareReturn(declaration);
      const effects = input.records.errorEffects.get(declaration);
      if (physicalInputs.some(selected => selected.kind === "unresolved") || output.kind === "unresolved" || effects === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native Future requires its completed physical inputs, output and native error effects.", declaration);
      const captures = input.records.closureCapture.get(declaration);
      retainEnvironment = selectRustNativeFutureEnvironmentRetention({ lifetime: retained.lifetime,
        taskScope: retained.inputs.some(selected => selected.kind === "native-task-scope"),
        carriers: [...source, ...body, ...physicalInputs.map(selected => {
          if (selected.kind === "unresolved")
            failTargetAnalysisInvariant("tsonic-rust", "A completed native Future input requires its selected physical carrier.", declaration);
          return selected.carrier;
        }), output.carrier, ...effects.nativeErrors.map(error => error.errorType),
          ...effects.localErrors ? [rustProgramErrorTargetType()] : [],
          ...environment.inputs.map(selected => selected.carrier), ...environment.captures.map(selected => selected.carrier),
          ...captures?.captures.map(capture => capture.carrier) ?? [],
          ...captures?.receiverFields.map(capture => capture.carrier) ?? [],
          ...captures?.receivers.map(capture => capture.carrier) ?? []],
      });
    }
    if (retainEnvironment)
      retention = Object.freeze({ lifetime: retained.lifetime, source: Object.freeze(source), body: Object.freeze(body) });
    else implicitLifetimes = Object.freeze(implicitLifetimes.filter(parameter =>
      parameter.kind !== "lifetime" || rustLifetimeKey(parameter.lifetime) !== rustLifetimeKey(retained.lifetime)));
  }
  const callableInputs = Object.freeze([...input.native.inputsFor(declaration), ...input.native.capturesFor(declaration)]);
  const inputs = Object.freeze([...new Map([...callableInputs, ...environment.inputs, ...environment.captures]
    .map(selected => [selected.implementation.identity, selected] as const)).values()]);
  return resolvedTargetStage(Object.freeze({ sourceContract, implicitLifetimes, retention, futureEnvironment: environment,
    callableInputs, inputs }));
}
