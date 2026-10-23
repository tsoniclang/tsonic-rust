import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { rejectedTargetStage, resolvedTargetStage, type TargetDiagnostic, type TargetStageResult } from "@tsonic/target-api/artifacts";
import { Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustLifetimeKey, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import { rustOwnedStorageChildren } from "../../policy/types/storage/owned-storage.js";

const containsCallableStorage = (carrier: TargetTypeRef): boolean => rustCallableProtocol(carrier) !== undefined ||
  rustOwnedStorageChildren(carrier).some(containsCallableStorage);

const ownedLifetimes = (carrier: TargetTypeRef): TargetTypeRef => {
  const references = rustTargetGenericReferences(carrier);
  const lifetimes = new Map([...references.lifetimes, ...references.callScopedElisions, ...references.elisionInputs]
    .filter(lifetime => lifetime.kind !== "static").map(lifetime => [rustLifetimeKey(lifetime), rustStaticLifetime] as const));
  return substituteElidedLifetime(substituteRustTargetGenerics(carrier, new Map(), lifetimes, new Map()), rustStaticLifetime);
};

export interface RustProjectCallableFieldStorage {
  get(declaration: Node): TargetTypeRef | undefined;
}

export interface RustProjectCallableFieldStorageConstruction extends RustProjectCallableFieldStorage {
  seal(): TargetStageResult<RustProjectCallableFieldStorage>;
}

export function prepareRustProjectCallableFieldStorage(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
}, subjectFor: (subject: Extract<ReturnType<SourceStorageQueries["subject"]>, { readonly kind: "resolved" }>["subject"],
  carrier: TargetTypeRef) => RustNativeStorageSelection): RustProjectCallableFieldStorageConstruction {
  const fields = new Map<Node, { readonly owned: boolean }>();
  for (const definition of input.projectTypes.definitions) {
    const owned = !definition.genericParameters.some(parameter => parameter.kind === "lifetime");
    for (const field of input.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
      fields.set(field.declaration, { owned });
    }
  }
  const selected = new Map<Node, TargetTypeRef>();
  const failures = new Map<Node, string>();
  let closed = false;
  const published = Object.freeze({ get: (declaration: Node) => selected.get(declaration) });
  const select = (declaration: Node): TargetTypeRef | undefined => {
    const existing = selected.get(declaration);
    if (existing !== undefined) return existing;
    const field = fields.get(declaration);
    const declared = field === undefined ? undefined : input.records.runtimeCarrier.get(declaration)?.carrier ??
      input.records.runtimeCarrier.get(Node_Type(input.ast, declaration))?.carrier;
    if (field === undefined || declared === undefined || !containsCallableStorage(declared)) return undefined;
    const subject = input.storage.subject(declaration, "member");
    if (subject.kind === "unresolved") { failures.set(declaration, subject.reason); return undefined; }
    const selection = subjectFor(subject.subject, declared);
    if (selection.kind === "unresolved") { failures.set(declaration, selection.reason); return undefined; }
    const carrier = field.owned ? ownedLifetimes(selection.carrier) : selection.carrier;
    selected.set(declaration, carrier);
    failures.delete(declaration);
    return carrier;
  };
  return Object.freeze({ get: (declaration: Node) => closed ? selected.get(declaration) : select(declaration),
    seal(): TargetStageResult<RustProjectCallableFieldStorage> {
      if (closed) return resolvedTargetStage(published);
      const issues: TargetDiagnostic[] = [];
      for (const declaration of fields.keys()) {
        const declared = input.records.runtimeCarrier.get(declaration)?.carrier ??
          input.records.runtimeCarrier.get(Node_Type(input.ast, declaration))?.carrier;
        if (declared === undefined || !containsCallableStorage(declared) || select(declaration) !== undefined) continue;
        const storageFailure = input.storage.failureReason();
        issues.push({ code: storageFailure === undefined ? "RUST_CALLABLE_VALUE_NOT_CLOSED" : "RUST_SOURCE_STORAGE_NOT_PROVEN",
          category: "error", source: "tsonic-rust", sourceNode: declaration,
          message: storageFailure ?? failures.get(declaration) ?? "A callable field requires its complete physical native member storage.",
          evidence: ["target.capability=rust.callable-value.exact-implementation"] });
      }
      if (issues.length !== 0) return rejectedTargetStage(Object.freeze(issues));
      closed = true;
      return resolvedTargetStage(published);
    } });
}
