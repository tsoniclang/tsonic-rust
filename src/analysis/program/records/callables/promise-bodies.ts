import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustPromiseBodies, RustPromiseBodyDeclaration } from "../../../../target-model/records/callables/callables-and-resources.js";

export function createRustPromiseBodyProducer(assertOpen: () => void): {
  readonly records: RustPromiseBodies;
  declaration(subject: Node, value: RustPromiseBodyDeclaration): void;
  object(subject: Node, value: readonly Node[]): void;
  pinned(subject: Node, value: ReadonlyMap<string, ReadonlySet<Node>>): void;
} {
  const declarations = new Map<Node, RustPromiseBodyDeclaration>();
  const objects = new Map<Node, readonly Node[]>();
  const pinnedInvocations = new Map<Node, ReadonlyMap<string, ReadonlySet<Node>>>();
  const write = <Value>(values: Map<Node, Value>, subject: Node, value: Value): void => {
    assertOpen();
    if (values.has(subject)) failTargetAnalysisInvariant("tsonic-rust",
      "A native Promise body record has exactly one selected publication.", subject);
    values.set(subject, value);
  };
  return Object.freeze({ records: Object.freeze({ declarations, objects, pinnedInvocations }),
    declaration: (subject: Node, value: RustPromiseBodyDeclaration): void => write(declarations, subject, Object.freeze(value)),
    object: (subject: Node, value: readonly Node[]): void => write(objects, subject, Object.freeze([...value])),
    pinned: (subject: Node, value: ReadonlyMap<string, ReadonlySet<Node>>): void => write(pinnedInvocations, subject,
      new Map([...value].map(([name, calls]) => [name, new Set(calls)]))),
  });
}
