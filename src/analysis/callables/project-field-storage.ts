import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Initializer, Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import { rustTargetGenericReferences } from "../../target-model/types/carriers/generic-references.js";
import { substituteRustTargetGenerics } from "../../target-model/types/carriers/substitution.js";
import { substituteElidedLifetime } from "../../target-model/types/carriers/lifetime-elision.js";
import { rustLifetimeKey, rustStaticLifetime } from "../../target-model/lifetimes/index.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";

const ownedLifetimes = (carrier: TargetTypeRef): TargetTypeRef => {
  const references = rustTargetGenericReferences(carrier);
  const lifetimes = new Map([...references.lifetimes, ...references.callScopedElisions, ...references.elisionInputs]
    .filter(lifetime => lifetime.kind !== "static").map(lifetime => [rustLifetimeKey(lifetime), rustStaticLifetime] as const));
  return substituteElidedLifetime(substituteRustTargetGenerics(carrier, new Map(), lifetimes, new Map()), rustStaticLifetime);
};

/** Physical callable storage of project class fields, keyed by field declaration. */
export interface RustProjectCallableFieldStorage {
  get(declaration: Node): TargetTypeRef | undefined;
}

// A project class instance owns its state and its native struct has no lifetime parameters, so a field that stores a
// callable value takes the physical carrier its stored producers select (the same selection every read of the field
// uses), not the declared logical carrier with its placeholder lifetime and logical error channel. Producers seal their
// physical implementations when the callable values publish, so the selection runs on first use after that.
export function prepareRustProjectCallableFieldStorage(input: {
  readonly ast: AstReader;
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly projectTypes: RustProjectTypePolicy;
}, subjectFor: (subject: Extract<ReturnType<SourceStorageQueries["subject"]>, { readonly kind: "resolved" }>["subject"],
  carrier: TargetTypeRef) => RustNativeStorageSelection): RustProjectCallableFieldStorage {
  const fields = new Map<Node, { readonly initializer: Node; readonly owned: boolean }>();
  for (const definition of input.projectTypes.definitions) {
    // Without lifetime parameters the native struct owns its fields, so their stored lifetimes are static.
    const owned = !definition.genericParameters.some(parameter => parameter.kind === "lifetime");
    for (const field of input.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
      // The declaration is its own storage origin; its stored producer is the initializer value.
      const initializer = Node_Initializer(input.ast, field.declaration);
      if (initializer !== undefined) fields.set(field.declaration, { initializer, owned });
    }
  }
  const selected = new Map<Node, TargetTypeRef>();
  return Object.freeze({ get(declaration: Node): TargetTypeRef | undefined {
    const existing = selected.get(declaration);
    if (existing !== undefined) return existing;
    const field = fields.get(declaration);
    const initializer = field?.initializer;
    const declared = initializer === undefined ? undefined : input.records.runtimeCarrier.get(declaration)?.carrier ??
      input.records.runtimeCarrier.get(Node_Type(input.ast, declaration))?.carrier;
    if (initializer === undefined || declared === undefined || rustCallableProtocol(declared) === undefined) return undefined;
    const subject = input.storage.subject(initializer, "value");
    if (subject.kind === "unresolved") return undefined;
    // Only a completed selection is kept: before the producers seal their physical implementations the selection is
    // not yet available, and the declared logical carrier stays in use until it is.
    const selection = subjectFor(subject.subject, declared);
    if (selection.kind === "unresolved") return undefined;
    const carrier = field!.owned ? ownedLifetimes(selection.carrier) : selection.carrier;
    selected.set(declaration, carrier);
    return carrier;
  } });
}
