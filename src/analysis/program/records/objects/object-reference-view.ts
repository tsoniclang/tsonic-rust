import type { Node } from "@tsonic/tsts";
import type { RustObjectReferenceView } from "../../../../target-model/records/objects/object-reference-views.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { selectRustObjectReferenceView } from "../../../operations/object-reference-views.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustProjectMemberSelectionEquals } from "../../../../target-model/records/operations/operation-equality.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { requireRustRecord } from "./required-records.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

export interface RustObjectReferenceViewProducer {
  readonly records: RustRecordFamily<RustObjectReferenceView>;
  select(walk: RustFactWalk, expression: Node, sourceCarrier: TargetTypeRef, targetCarrier: TargetTypeRef): RustObjectReferenceView | undefined;
}

export function createRustObjectReferenceViewProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustObjectReferenceView>,
): RustObjectReferenceViewProducer {
  const family = createRustRecordFamily({ id: "tsonic.rust.objectReferenceView", equals: rustObjectReferenceViewEquals }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    select: createRustObjectReferenceViewQuery({ assertOpen, records: family.reader,
      publish: (expression, view) => family.writer.set(expression, view) }),
  });
}

type RustObjectReferenceViewQuery = (
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
) => RustObjectReferenceView | undefined;

function createRustObjectReferenceViewQuery(input: {
  readonly assertOpen: () => void;
  readonly records: RustRecordFamily<RustObjectReferenceView>;
  readonly publish: (expression: Node, view: RustObjectReferenceView) => void;
}): RustObjectReferenceViewQuery {
  const completed = new WeakMap<Node, { readonly canonical: RustObjectReferenceView;
    readonly walks: WeakSet<RustFactWalk> }>();
  return (walk, expression, sourceCarrier, targetCarrier) => {
    input.assertOpen();
    const previous = input.records.get(expression);
    const completion = completed.get(expression);
    if (previous !== undefined && completion?.canonical === previous && completion.walks.has(walk) &&
      rustTargetTypeRefEquals(previous.sourceCarrier, sourceCarrier) &&
      rustTargetTypeRefEquals(previous.targetCarrier, targetCarrier)) return previous;
    const selected = selectRustObjectReferenceView(walk, expression, sourceCarrier, targetCarrier);
    if (selected === undefined) return undefined;
    requireRustRecord(walk.context.requiredRecords, "objectReferenceView", expression, selected.kind, "createRustObjectReferenceViewQuery");
    if (previous !== undefined && !rustObjectReferenceViewEquals(previous, selected)) {
      failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.objectReferenceView' for one exact source subject.",
      );
    }
    if (previous === undefined) input.publish(expression, selected);
    const canonical = previous ?? input.records.get(expression)!;
    const walks = completion?.canonical === canonical ? completion.walks : new WeakSet<RustFactWalk>();
    walks.add(walk);
    completed.set(expression, { canonical, walks });
    return canonical;
  };
}

function rustObjectReferenceViewEquals(left: RustObjectReferenceView, right: RustObjectReferenceView): boolean {
  return rustTargetTypeRefEquals(left.sourceCarrier, right.sourceCarrier) &&
    rustTargetTypeRefEquals(left.targetCarrier, right.targetCarrier) &&
    left.kind === right.kind && (left.kind !== "structural" && right.kind !== "structural"
      ? left.declaration === right.declaration
      : left.kind === "structural" && right.kind === "structural" && left.fields.length === right.fields.length &&
        left.fields.every((field, index) => {
          const other = right.fields[index];
          return other !== undefined && field.destinationIndex === other.destinationIndex &&
            field.writable === other.writable && rustProjectMemberSelectionEquals(field.source, other.source);
        }));
}
