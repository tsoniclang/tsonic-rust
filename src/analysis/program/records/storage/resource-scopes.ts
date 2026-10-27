import type { Node } from "@tsonic/tsts";
import type { SourceResourceScope } from "@tsonic/target-api/analysis";
import type { RustResourceScopeRecords } from "../../../../target-model/records/storage/resource-scopes.js";
import { createRustRecordFamily } from "../family.js";

export interface RustResourceScopeProducer {
  readonly records: RustResourceScopeRecords;
  scope(subject: Node, scope: SourceResourceScope): void;
  variables(subject: Node, declarations: readonly Node[]): void;
  continuation(subject: Node, exits: boolean): void;
}

export function createRustResourceScopeProducer(assertOpen: () => void): RustResourceScopeProducer {
  const scopes = createRustRecordFamily<SourceResourceScope>({ id: "tsonic.rust.resourceScope",
    equals: (left, right) => left === right }, assertOpen);
  const variables = createRustRecordFamily<readonly Node[]>({ id: "tsonic.rust.variableDeclarations",
    equals: (left, right) => left === right }, assertOpen);
  const continuations = createRustRecordFamily<boolean>({ id: "tsonic.rust.resourceContinuationExit",
    equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ records: Object.freeze({ resourceScope: scopes.reader,
    variableDeclarations: variables.reader, resourceContinuationExit: continuations.reader }),
    scope(subject: Node, scope: SourceResourceScope): void { scopes.writer.set(subject, scope); },
    variables(subject: Node, declarations: readonly Node[]): void { variables.writer.set(subject, declarations); },
    continuation(subject: Node, exits: boolean): void { continuations.writer.set(subject, exits); },
  });
}
