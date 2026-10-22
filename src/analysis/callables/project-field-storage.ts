import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageQueries } from "@tsonic/target-api/analysis";
import { Node_Initializer, Node_Type } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustNativeStorageSelection } from "../../target-model/records/native-storage.js";
import { rustCallableProtocol } from "../../target-model/types/carriers/callables.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";

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
  const select = (): ReadonlyMap<Node, TargetTypeRef> => {
    const fields = new Map<Node, TargetTypeRef>();
    for (const definition of input.projectTypes.definitions) {
      for (const field of input.projectTypes.objectLayoutForDefinition(definition)?.fields ?? []) {
        const declared = input.records.runtimeCarrier.get(field.declaration)?.carrier ??
          input.records.runtimeCarrier.get(Node_Type(input.ast, field.declaration))?.carrier;
        if (declared === undefined || rustCallableProtocol(declared) === undefined) continue;
        // The declaration is its own storage origin; its stored producer is the initializer value.
        const initializer = Node_Initializer(input.ast, field.declaration);
        if (initializer === undefined) continue;
        const subject = input.storage.subject(initializer, "value");
        if (subject.kind === "unresolved") continue;
        const selected = subjectFor(subject.subject, declared);
        if (selected.kind !== "unresolved") fields.set(field.declaration, selected.carrier);
      }
    }
    return fields;
  };
  let fields: ReadonlyMap<Node, TargetTypeRef> | undefined;
  return Object.freeze({ get: (declaration: Node) => (fields ??= select()).get(declaration) });
}
