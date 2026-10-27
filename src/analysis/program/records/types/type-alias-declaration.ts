import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import type { RustTypeAliasDeclarationFact } from "../../../../target-model/records/callables/callables-and-resources.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { selectRustTypeAliasDeclaration } from "../../../declarations/type-aliases.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";
import { requireRustRecord } from "../objects/required-records.js";

export interface RustTypeAliasDeclarationProducer {
  readonly records: RustRecordFamily<RustTypeAliasDeclarationFact>;
  register(walk: RustFactWalk, declaration: Node): void;
}

export function createRustTypeAliasDeclarationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustTypeAliasDeclarationFact>,
): RustTypeAliasDeclarationProducer {
  const corresponds = (left: RustTypeAliasDeclarationFact, right: RustTypeAliasDeclarationFact) =>
    left.kind === right.kind && (left.kind !== "native-alias" ||
      right.kind === "native-alias" && rustTargetTypeRefEquals(left.target, right.target)) &&
    (left.kind === "native-alias" || closedMetadataEquals(left, right));
  const family = createRustRecordFamily<RustTypeAliasDeclarationFact>({ id: "tsonic.rust.typeAliasDeclaration",
    equals: corresponds }, assertOpen, inherited);
  const completedRequests = new WeakMap<Node, RustFactWalk>();
  return Object.freeze({
    records: family.reader,
    register(walk: RustFactWalk, declaration: Node): void {
      assertOpen();
      const existing = family.reader.get(declaration);
      if (existing !== undefined && completedRequests.get(declaration) === walk) return;
      const selected = selectRustTypeAliasDeclaration(walk, declaration);
      if (selected === undefined) return;
      requireRustRecord(walk.context.requiredRecords, "typeAliasDeclaration", declaration,
        selected.kind, "typeAliasDeclarations.register");
      if (existing !== undefined && !corresponds(existing, selected)) failTargetAnalysisInvariant("tsonic-rust",
        "Conflicting Rust semantic plan 'tsonic.rust.typeAliasDeclaration' for one exact source subject.");
      if (existing === undefined) family.writer.set(declaration, selected);
      completedRequests.set(declaration, walk);
    },
  });
}
