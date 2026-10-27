import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustPropertyReadProducer } from "../program/records/objects/property-reads.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { rustCallableProtocol, rustSourceTypeCarrierValue } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";

export function analyzeRustPropertyReads(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustPropertyReadProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  const refuse = (node: Node, capability: string, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  const method = (node: Node, declaration: Node, receiver: TargetTypeRef, carrier: TargetTypeRef): void => {
    if (producer.records.boundMethod.get(declaration, receiver, carrier) !== undefined) return;
    const callable = rustCallableProtocol(carrier);
    const definition = program.projectTypes.definitionForCarrier(receiver);
    if (definition === undefined || callable === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "An admitted bound method requires its exact nominal receiver and callable ABI.", node);
    const polymorphic = program.projectTypes.isPolymorphic(definition);
    const variant = polymorphic ? program.projectMethodDispatch.variantForMember(declaration, []) : undefined;
    let implementation = declaration;
    let name: string;
    if (polymorphic) {
      if (variant === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted bound virtual method requires its exact native dispatch slot.", node);
      name = variant.virtualSlot;
    } else {
      const selected = program.projectTypes.memberImplementation(definition, declaration);
      if (selected?.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted exact bound method requires its checked implementation.", node);
      const body = program.sourceNavigation.callableImplementation(selected.implementation.declaration);
      if (body.kind !== "resolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted exact bound method requires its native callable body.", node);
      implementation = body.implementation.declaration;
      const identifier = program.names.nameForDeclaration(implementation);
      if (identifier === undefined || !isValidRustIdentifier(identifier))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted bound method requires its exact native identifier.", node);
      name = identifier;
    }
    producer.method(declaration, receiver, carrier, { method: name, dispatch: polymorphic,
      parameters: Object.freeze([...callable.parameters]), fallible: program.records.fallible.get(implementation) !== undefined || program.records.fallible.get(declaration) !== undefined });
  };
  const accessor = (node: Node, fact: Pick<Extract<RustTargetOperationFact, { readonly kind: "source-accessor" }>,
    "receiver" | "dispatch" | "read" | "write">, receiver: TargetTypeRef | undefined): void => {
    if (fact.receiver.kind === "static") return;
    if (receiver === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted instance accessor requires its exact checked receiver carrier.", node);
    if (fact.dispatch === undefined) return;
    for (const selected of [fact.read, fact.write]) {
      if (selected === undefined) continue;
      const owner = program.projectTypes.definitionContainingDeclaration(selected.declaration);
      const relation = owner === undefined ? undefined : program.projectTypes.relationship(receiver, owner);
      if (relation?.kind !== "related" || !rustTargetTypeRefEquals(relation.targetType, fact.dispatch.ownerCarrier))
        refuse(node, "rust.backend.project-accessor-dispatch-receiver", "Project accessor dispatch conflicts with its exact finalized receiver relationship.");
    }
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "source-method-property") method(node, fact.declaration, fact.receiverCarrier, fact.callableCarrier);
    if (fact?.kind === "record-literal") for (const contribution of fact.contributions) {
      if (contribution.kind !== "spread") continue;
      for (const selected of contribution.methods) method(node, selected.contractDeclaration, contribution.sourceValueCarrier, selected.callableCarrier);
    }
    if (fact?.kind === "source-accessor") {
      const receiver = Node_Expression(ast, node);
      accessor(node, fact, receiver === undefined ? undefined : program.records.valueRead.get(receiver)?.value);
      if (fact.accessMode !== "write" && (fact.read === undefined || !rustTargetTypeRefEquals(fact.read.resultCarrier, fact.resultCarrier)))
        refuse(node, "rust.backend.source-accessor-read", "Project accessor read requires one exact getter and result carrier.");
    }
    for (const projection of program.records.propertyProjection.get(node)?.cases ?? []) for (const read of projection.reads)
      if (read.kind === "source-accessor") accessor(node, read, projection.source);
    if (fact?.kind === "source-enum-member" && rustSourceTypeCarrierValue(fact.resultCarrier) === undefined)
      refuse(node, "rust.backend.enum", "Enum member access does not resolve to a generated Rust enum path.", true);
    if (fact?.kind !== "source-field" && fact?.kind !== "source-accessor" && fact?.kind !== "source-static-field" &&
      fact?.kind !== "source-method-property" && fact?.kind !== "source-union-field" && fact?.kind !== "source-enum-member") continue;
    if (!ast.is.IsPropertyAccessExpression(node) && !ast.is.IsElementAccessExpression(node)) continue;
    const selected = program.records.selectedOperation.get(node);
    const result = program.records.optionalChain.get(node)?.resultCarrier ?? fact.resultCarrier;
    if (selected === undefined || selected.operationKind !== "property" || selected.operationId !== fact.operationId ||
      !rustTargetTypeRefEquals(selected.resultType, result) || fact.kind === "source-method-property" &&
        (rustCallableProtocol(fact.callableCarrier) === undefined || !rustTargetTypeRefEquals(result, fact.callableCarrier))) {
      const diagnostic = propertyCorrespondenceDiagnostics[fact.kind];
      refuse(node, diagnostic.capability, diagnostic.message);
    }
  }
  return Object.freeze(issues);
}

const propertyCorrespondenceDiagnostics = {
  "source-accessor": { capability: "rust.backend.source-accessor-selected-evidence", message: "Project accessor read conflicts with the TSTS-selected property fact." },
  "source-static-field": { capability: "rust.backend.source-static-field-selected-evidence", message: "Project static-field read conflicts with the TSTS-selected property fact." },
  "source-field": { capability: "rust.backend.source-field-selected-evidence", message: "Project-source field fact conflicts with the TSTS-selected property fact." },
  "source-union-field": { capability: "rust.backend.source-union-field-selected-evidence", message: "Source-union field fact conflicts with the TSTS-selected property fact." },
  "source-enum-member": { capability: "rust.backend.enum-member-selected-evidence", message: "Project-source enum member fact conflicts with the TSTS-selected property fact." },
  "source-method-property": { capability: "rust.backend.source-method-property-selected-evidence", message: "Project method-property read conflicts with its exact selected callable evidence." },
} as const;
