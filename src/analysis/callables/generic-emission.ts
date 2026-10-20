import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustGenericEmissionProducer } from "../program/records/generic-emission.js";
import type { RustGenericMemberEmission } from "../../target-model/records/generic-emission.js";
import type { RustGenericCallableImplementation, RustGenericCallablePhysicalMember } from "../../target-model/records/generic-callables.js";
import { rustGenericCallableCarrier, rustGenericCallableProtocol, rustNativeFutureCallableResult } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableStorageArguments } from "../../target-model/types/carriers/generic-callable-storage.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustGenericCallableSignaturesMatch } from "../../policy/conversions/generic-callable.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSourceCallableValueFact } from "../../target-model/records/operation-selections.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";

export function analyzeRustGenericEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly sourceFiles: readonly SourceFile[];
  readonly nodes: readonly Node[];
  readonly producer: RustGenericEmissionProducer;
  readonly sourceValues: readonly RustSourceCallableValueFact[];
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
  const requests = new Map<Node, Map<string, TargetTypeRef>>();
  const request = (node: Node, carrier: TargetTypeRef): void => {
    if (rustGenericCallableProtocol(carrier) === undefined) return;
    const rows = requests.get(node) ?? new Map<string, TargetTypeRef>();
    rows.set(closedMetadataKey(carrier), carrier);
    requests.set(node, rows);
  };
  for (const node of input.nodes) {
    const comparison = program.callableValues.genericIdentities.forComparison(node);
    if (comparison !== undefined) {
      const leftRead = program.ownership.reads.get(comparison.leftNode);
      const rightRead = program.ownership.reads.get(comparison.rightNode);
      if (leftRead === undefined || rightRead === undefined ||
        program.records.selectedOperation.get(node)?.operationId !== comparison.operation.operationId)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted callable comparison requires its exact native ownership and selected identity operation.", node);
      producer.identity(node, { comparison,
        stableLeft: leftRead.stablePlace || leftRead.borrowedAcross.has(comparison.rightNode),
        stableRight: rightRead.stablePlace || rightRead.borrowedAcross.has(comparison.rightNode),
        constant: comparison.pairs.length === 0 || comparison.exhaustive && comparison.pairs.every(pair => pair.kind === "declaration")
          ? (comparison.pairs.length !== 0) === (comparison.operation.operator === "==") : undefined });
    }
    const implementation = generic.implementationFor(node);
    if (implementation === undefined) continue;
    const selected = program.callableValues.nativeStorage.operandFor(node);
    if (selected.kind === "unresolved") continue;
    request(node, selected.carrier);
  }
  for (const value of input.sourceValues) request(value.sourceDeclaration, value.carrier);
  for (const [node, carriers] of requests) for (const carrier of carriers.values()) {
    const implementation = generic.implementationFor(node);
    if (implementation === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted generic source callable requires its exact native implementation.", node);
    const definition = generic.physical.definitionFor(carrier);
    if (definition === undefined) continue;
    const member = definition.members.length === 1 ? definition.members[0] : undefined;
    const environment = generic.physical.environmentFor(implementation);
    if (member?.implementation !== implementation || environment === undefined || !rustGenericCallableSignaturesMatch(implementation.carrier, carrier))
      failTargetAnalysisInvariant("tsonic-rust", "A generic callable requires one sealed native implementation and environment.", node);
    producer.value(node, { carrier, implementation, member,
      marker: definition.signature.environmentParameters.length + environment.parameters.length > 0 });
  }
  for (const definition of physical) {
    const invoked = program.callableValues.genericDispatch.requiredFor(definition);
    const identity = program.callableValues.genericIdentities.forDefinition(definition);
    if (!invoked) {
      producer.definition(definition, { invoked: false, identity });
      continue;
    }
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
      const selected = completion.kind === "selected" ? completion.members.get(member) : undefined;
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
      identity,
      nativeFuture: future === undefined ? undefined : Object.freeze({ optional: future.optional }), members });
  }
  for (const sourceFile of input.sourceFiles) {
    const fileName = program.source.ast.getFileName(sourceFile);
    producer.sourceFile(sourceFile, { implementations: Object.freeze([...implementations].filter(implementation => implementation.sourceFileName === fileName)),
      definitions: Object.freeze(physical.filter(definition => definition.ownerFileName === fileName)) });
  }
}
