import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { type TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustProjectClassProducer } from "../program/records/project-classes.js";
import type { RustProjectTypeDefinition } from "../../target-model/types/project-types.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustCallableInvocationResult } from "../../policy/types/callables/return-contexts.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { selectRustProjectCallableSignature } from "../../policy/types/objects/project-dispatch-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { createRustSourceCallableContract } from "../callables/calls/source-callable-abi.js";

export function closeRustProjectCallableContracts(
  program: Omit<RustAnalysisProgram, "reachability">,
  source: TargetSourceProgram,
  members: ReadonlyMap<RustProjectTypeDefinition, readonly Node[]>,
  producer: RustProjectClassProducer,
): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const callableDeclarations = new Set<Node>();
  for (const [definition, declarations] of members) {
    const polymorphic = program.projectTypes.isPolymorphic(definition);
    for (const member of declarations) {
      if (ast.hasModifierKind(member, "static")) continue;
      if (!polymorphic && program.projectMethodProperties.usageFor(member)?.writable !== true) continue;
      if (ast.is.IsMethodDeclaration(member) || ast.kindName(member) === "KindMethodSignature" ||
        ast.kindName(member) === "KindGetAccessor" || ast.kindName(member) === "KindSetAccessor") callableDeclarations.add(member);
    }
  }
  const classDefinitions = program.projectTypes.definitions.filter(definition => definition.kind === "class");
  const slotResult = (member: Node): TargetTypeRef | undefined => {
    const logical = rustCallableInvocationResult(program.records, member);
    if (logical === undefined || rustCallableProtocol(logical) === undefined ||
      program.records.asyncFunction.get(member) !== undefined || program.records.generator.get(member) !== undefined) return logical;
    const implementations = new Set<Node>(ast.body(member) === undefined ? [] : [member]);
    for (const definition of classDefinitions) {
      const selected = program.projectTypes.memberImplementation(definition, member);
      if (selected.kind === "resolved" && ast.body(selected.implementation.declaration) !== undefined)
        implementations.add(selected.implementation.declaration);
    }
    let physical: TargetTypeRef | undefined;
    for (const implementation of implementations) {
      const selected = program.callableValues.nativeStorage.returnFor(implementation);
      if (selected.kind === "unresolved" || selected.kind === "selected" && selected.inputs.length !== 0) return logical;
      if (physical !== undefined && !rustTargetTypeRefEquals(physical, selected.carrier)) return logical;
      physical = selected.carrier;
    }
    return physical ?? logical;
  };
  for (const member of callableDeclarations) {
    const asynchronous = program.records.asyncFunction.get(member);
    const typeParameters = ast.typeParameters(member).map(parameter => {
      const selected = program.sourceLifetimes.parameterFor(parameter);
      return selected?.kind === "type" ? selected.identity : undefined;
    });
    const result = slotResult(member);
    const effects = program.records.sourceCallEffects.get(member);
    if (result === undefined || effects === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted project callable requires its exact native result and invocation effects.", member);
    const safety = (placement: "declaration" | "getter" | "setter"): boolean => {
      const selected = program.safetyApplications.forDeclaration(member).filter(application => application.applicationPlacement === placement);
      return selected.length !== 0 && selected.every(application => application.contract === "requires-unsafe");
    };
    let error: TargetTypeRef | undefined;
    if (effects.invocation === "fallible") {
      const selected = program.records.projectMemberError.get(member);
      if (selected === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted project callable requires one exact declaration-owned native error ABI.", member);
      error = selected.carrier;
    }
    const signature = selectRustProjectCallableSignature({ typeParameters, result, effects, error,
      generator: program.records.generator.get(member) !== undefined, asynchronous: asynchronous?.kind, authoredAsync: ast.hasModifierKind(member, "async"),
      safety: Object.freeze({ declaration: safety("declaration"), getter: safety("getter"), setter: safety("setter") }) });
    if (signature === undefined) {
      issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: member,
        message: `Polymorphic project methods require an exact object-safe native invocation ABI. Node kind: ${ast.kindName(member)}.`,
        evidence: ["target.capability=rust.backend.project-dispatch-object-safety"] });
    } else {
      const contract = createRustSourceCallableContract({ source, records: program.records,
        sourceLifetimes: program.sourceLifetimes }, member, signature.returnCarrier);
      if (contract === undefined) failTargetAnalysisInvariant("tsonic-rust",
        "An admitted project callable requires its exact checked source value parameters and native formal ABI.", member);
      producer.callable(member, Object.freeze({ ...signature, contract }));
    }
  }
  return Object.freeze(issues);
}
