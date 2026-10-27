import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceStorageBindings, SourceStorageProducer, SourceStorageProducersSelection, SourceStorageQueries } from "@tsonic/target-api/analysis";
import { BinaryExpression_Left, BinaryExpression_OperatorToken, BinaryExpression_Right, Node_Initializer, sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { rustGenericCallableValue } from "../../../target-model/types/carriers/generic-callables.js";

export interface RustRecordMemberProducers {
  // Producers of a generic callable storage, extended by every value written into the record interface members its
  // producers are written into: a record field stores one family for all its writes, whichever instance is read.
  extend(selection: SourceStorageProducersSelection): SourceStorageProducersSelection;
  // The file owning a record member family: the first member declaration it stores, so every storage names one family.
  ownerFileFor(selection: SourceStorageProducersSelection): string | undefined;
}

export function createRustRecordMemberProducers(input: {
  readonly ast: AstReader;
  readonly nativeNodes: readonly Node[];
  readonly records: RustProgramRecords;
  readonly storage: SourceStorageQueries;
  readonly bindingsFor: (owner: Node | undefined) => SourceStorageBindings | undefined;
}): RustRecordMemberProducers {
  const { ast, records, storage } = input;
  let index: { readonly writes: ReadonlyMap<Node, readonly Node[]>; readonly properties: ReadonlyMap<Node, Node> } | undefined;
  const writesIndex = () => {
    if (index !== undefined) return index;
    const writes = new Map<Node, Node[]>();
    const properties = new Map<Node, Node>();
    for (const node of input.nativeNodes) {
      // An assignment to a stored record member writes into the member's family like a literal does.
      if (ast.is.IsBinaryExpression(node)) {
        const left = BinaryExpression_Left(ast, node);
        const right = BinaryExpression_Right(ast, node);
        const operator = BinaryExpression_OperatorToken(ast, node);
        const field = left === undefined ? undefined : records.targetOperation.get(left);
        const generic = field?.kind === "source-field" ? rustGenericCallableValue(field.resultCarrier) : undefined;
        if (right !== undefined && operator !== undefined && ast.kindName(operator) === "KindEqualsToken" &&
          field?.kind === "source-field" && field.storage === "project-object" && field.declaration !== undefined &&
          generic !== undefined && generic.physical === undefined)
          writes.set(field.declaration, [...writes.get(field.declaration) ?? [], right]);
      }
      const operation = records.targetOperation.get(node);
      if (operation?.kind !== "record-literal" || operation.storage !== "project-object") continue;
      for (const contribution of operation.contributions) {
        if (contribution.kind !== "property") continue;
        const field = operation.fields.find(candidate => candidate.storageIndex === contribution.targetStorageIndex);
        const generic = rustGenericCallableValue(field?.carrier);
        if (field === undefined || generic === undefined || generic.physical !== undefined) continue;
        const value = ast.is.IsShorthandPropertyAssignment(contribution.property) ? ast.name(contribution.property)
          : Node_Initializer(ast, contribution.property);
        if (value === undefined) continue;
        for (const member of field.contractDeclarations) {
          writes.set(member, [...writes.get(member) ?? [], value]);
          properties.set(contribution.property, member);
        }
      }
    }
    index = { writes, properties };
    return index;
  };
  const extended = new WeakMap<SourceStorageProducersSelection, string>();
  const producersOfWrite = new Map<Node, SourceStorageProducersSelection>();
  const writeProducers = (value: Node): SourceStorageProducersSelection => {
    const cached = producersOfWrite.get(value);
    if (cached !== undefined) return cached;
    const subject = storage.subjectFor(value);
    // The written value is created in the callable containing the record literal (a callable value is not its own owner).
    const parent = ast.parent(value);
    const bindings = parent === undefined ? undefined : input.bindingsFor(sourceEnclosingCallable(parent, ast));
    const selected = subject.kind === "unresolved" ? subject : bindings === undefined
      ? Object.freeze({ kind: "unresolved" as const, reason: "A record member write requires its exact owner bindings." })
      : storage.storageProducersFor(subject.subject, bindings);
    producersOfWrite.set(value, selected);
    return selected;
  };
  return Object.freeze({
    ownerFileFor: (selection: SourceStorageProducersSelection) => extended.get(selection),
    extend(selection: SourceStorageProducersSelection): SourceStorageProducersSelection {
      if (selection.kind === "unresolved") return selection;
      const { writes, properties } = writesIndex();
      if (writes.size === 0) return selection;
      const members = new Set<Node>();
      // An open selection is covered only when every boundary is the external writability of an indexed record member:
      // the member's storage type admits only the family of its writes.
      if (selection.kind === "open") for (const boundary of selection.boundaries) {
        const member = boundary.subject.kind === "member" ? properties.get(boundary.subject.node) : undefined;
        if (member === undefined) return selection;
        members.add(member);
      }
      // A producer that is itself a read of an indexed member stands for that member's stored values.
      const memberRead = (producer: SourceStorageProducer): Node | undefined => {
        const operation = producer.subject.kind === "value" && producer.subject.projection.length === 0
          ? records.targetOperation.get(producer.subject.node) : undefined;
        return operation?.kind === "source-field" && operation.declaration !== undefined && writes.has(operation.declaration)
          ? operation.declaration : undefined;
      };
      for (const producer of selection.producers) {
        const member = memberRead(producer);
        if (member !== undefined) members.add(member);
      }
      const producers: SourceStorageProducer[] = selection.producers.filter(producer => memberRead(producer) === undefined);
      const seen = new Set(producers.map(producer => producer.subject));
      const visited = new Set<Node>();
      for (let changed = true; changed;) {
        changed = false;
        for (const [member, values] of writes) {
          if (visited.has(member)) continue;
          let reached = members.has(member);
          const selected: SourceStorageProducer[] = [];
          for (const value of values) {
            const written = writeProducers(value);
            if (written.kind !== "complete") {
              if (reached) return written.kind === "unresolved" ? written : Object.freeze({ kind: "unresolved" as const,
                reason: "A record generic callable member requires the closed producers of every value written into it." });
              continue;
            }
            selected.push(...written.producers);
            if (written.producers.some(producer => seen.has(producer.subject))) reached = true;
          }
          if (!reached) continue;
          visited.add(member);
          changed = true;
          for (const producer of selected) if (!seen.has(producer.subject)) {
            seen.add(producer.subject);
            producers.push(producer);
          }
        }
      }
      if (visited.size === 0) return selection;
      // Every storage reaching the member selects the same family: members follow source order, not discovery order.
      const key = (node: Node): string => sourceNodeIdentity(ast, node) ?? "";
      producers.sort((left, right) => key(left.subject.node) < key(right.subject.node) ? -1 : key(left.subject.node) > key(right.subject.node) ? 1 : 0);
      const owner = [...visited].sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0)[0]!;
      const result: SourceStorageProducersSelection = Object.freeze({ kind: "complete", producers: Object.freeze(producers) });
      extended.set(result, ast.getFileName(ast.getSourceFile(owner)));
      return result;
    },
  });
}
