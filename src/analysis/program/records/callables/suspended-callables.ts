import type { RustSuspendedCallablePlan } from "../../../../target-model/records/callables/suspended-callables.js";
import type { RustSourceCallableSpecializationIssue } from "../../../../target-model/records/callables/callable-issues.js";
import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustSuspendedCallableEmission, RustSuspendedCallableImplementation } from "../../../../target-model/records/callables/suspended-callables.js";
import { createRustRecordFamily } from "../family.js";

export interface RustSuspendedCallableProducer {
  readonly declarations: RustRecordFamily<readonly RustSuspendedCallableImplementation[]>;
  readonly implementations: RustRecordFamily<RustSuspendedCallableEmission>;
  declaration(subject: Node, value: RustSuspendedCallableEmission): void;
  sourceFile(subject: Node, values: readonly RustSuspendedCallableImplementation[]): void;
}

export function createRustSuspendedCallableProducer(assertOpen: () => void): RustSuspendedCallableProducer {
  const implementations = createRustRecordFamily<RustSuspendedCallableEmission>({ id: "tsonic.rust.suspendedDeclaration", equals: (left, right) => left === right }, assertOpen);
  const declarations = createRustRecordFamily<readonly RustSuspendedCallableImplementation[]>({ id: "tsonic.rust.suspendedDeclarations", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ declarations: declarations.reader, implementations: implementations.reader,
    declaration: (subject: Node, value: RustSuspendedCallableEmission): void => implementations.writer.set(subject, Object.freeze(value)),
    sourceFile: (subject: Node, values: readonly RustSuspendedCallableImplementation[]): void => declarations.writer.set(subject, Object.freeze(values)),
  });
}

export function sealRustSuspendedCallablePlan(
  implementations: ReadonlyMap<Node, RustSuspendedCallableImplementation>,
  issues: readonly RustSourceCallableSpecializationIssue[],
): RustSuspendedCallablePlan {
  return Object.freeze({ implementations: Object.freeze([...implementations.values()]),
    issues: Object.freeze([...issues]), implementationFor: (node: Node) => implementations.get(node),
  });
}
