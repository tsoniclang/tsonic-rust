import type { SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustGenericEmissionProducer } from "../program/records/generic-emission.js";
import type { RustGenericMemberEmission } from "../../target-model/records/generic-emission.js";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalMember } from "../../target-model/records/generic-callables.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol, rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../target-model/types/carriers/generic-callable-storage.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function analyzeRustGenericEmission(input: {
  readonly program: RustTargetProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly producer: RustGenericEmissionProducer;
}): void {
  const { program, producer } = input;
  const generic = program.callableValues.generic;
  const implementations = new Set<RustGenericCallableImplementation>();
  for (const definition of generic.definitions) for (const implementation of definition.implementations) {
    if (implementations.has(implementation)) continue;
    implementations.add(implementation);
    const environment = generic.physical.environmentFor(implementation);
    const requirements = program.declarationGenericRequirements.contractFor(implementation.declaration);
    if (environment === undefined || requirements === undefined) failTargetAnalysisInvariant("tsonic-rust",
      "An admitted generic implementation requires its finalized physical environment and generic contract.", implementation.declaration);
    producer.implementation(implementation, { environment, requirements,
      arguments: rustGenericCallableStorageArguments(definition.signature.environmentParameters, environment.parameters),
      suspended: program.records.asyncFunction.get(implementation.declaration) !== undefined || program.records.generator.get(implementation.declaration) !== undefined });
  }
  const physical = generic.physical.definitions();
  for (const definition of physical) {
    const invoked = program.callableValues.genericDispatch.requiredFor(definition);
    const completion = program.callableValues.genericCompletions.forDefinition(definition);
    const carrier = rustGenericCallableCarrier({ origin: definition.origin, signature: definition.signature,
      environment: definition.signature.environmentParameters });
    const protocol = rustGenericCallableProtocol(carrier);
    if (protocol === undefined || completion.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust",
      "An admitted generic definition requires its finalized quantified completion contract.");
    const future = rustNativeFutureCallableResult(protocol.result);
    const members = new Map<RustGenericCallablePhysicalMember, RustGenericMemberEmission>();
    const errors = program.records.genericCallableErrors.get(definition);
    for (const member of definition.members) {
      const declaration = member.implementation.declaration;
      const asyncFact = program.records.asyncFunction.get(declaration);
      const selected = completion.kind === "selected" ? completion.forMember(member) : undefined;
      if (completion.kind === "selected" && selected === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted generic member requires its exact selected completion.", declaration);
      const effects = program.records.sourceCallEffects.get(declaration);
      const returned = program.records.sourceCallableReturn.get(declaration);
      const nativeReturn = returned === undefined ? undefined : rustNativeFutureCallableResult(returned.returnCarrier);
      const memberError = errors?.members.get(member)?.awaiting;
      if (invoked && future !== undefined && (effects === undefined || returned === undefined ||
        asyncFact === undefined && nativeReturn === undefined || asyncFact !== undefined && asyncFact.kind !== "native-future"))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native generic future requires exact source completion and effect evidence.", declaration);
      members.set(member, Object.freeze({
        suspended: asyncFact !== undefined || program.records.generator.get(declaration) !== undefined,
        completionVariant: selected?.variant,
        future: future === undefined || effects === undefined || returned === undefined ? undefined : Object.freeze({
          effects, optional: asyncFact === undefined && nativeReturn?.optional === true,
          absent: returned.implementationCompletion === "absence",
          unchangedAwaitError: errors !== undefined && (errors.awaiting.length === 0 ||
            errors.awaiting.length === 1 && memberError !== undefined &&
              rustTargetTypeRefEquals(memberError.errorType, errors.awaiting[0]!.errorType)),
        }),
      }));
    }
    producer.definition(definition, { invoked, result: future?.output ?? completion.result, parameters: protocol.parameters,
      identity: program.callableValues.genericIdentities.forDefinition(definition),
      nativeFuture: future === undefined ? undefined : Object.freeze({ optional: future.optional }), members });
  }
  for (const sourceFile of input.sourceFiles) {
    const fileName = program.source.ast.getFileName(sourceFile);
    producer.sourceFile(sourceFile, { implementations: Object.freeze([...implementations].filter(implementation => implementation.sourceFileName === fileName)),
      definitions: Object.freeze(physical.filter(definition => definition.ownerFileName === fileName)) });
  }
}
