import type { Node } from "@tsonic/tsts";
import type { RustRecordFamily } from "../../../target-model/records/program.js";
import type { RustTypeAliasDeclarationFact } from "../../../target-model/records/callables-and-resources.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { selectRustTypeAliasDeclaration } from "../../declarations/types-and-bindings.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

export interface RustTypeAliasDeclarationProducer {
  readonly records: RustRecordFamily<RustTypeAliasDeclarationFact>;
  register(walk: RustFactWalk, declaration: Node): void;
}

export function createRustTypeAliasDeclarationProducer(
  assertOpen: () => void,
  inherited?: RustRecordFamily<RustTypeAliasDeclarationFact>,
): RustTypeAliasDeclarationProducer {
  const family = createRustRecordFamily<RustTypeAliasDeclarationFact>({ id: "tsonic.rust.typeAliasDeclaration",
    equals: (left, right) => left.kind === right.kind && (left.kind !== "native-alias" ||
      right.kind === "native-alias" && rustTargetTypeRefEquals(left.target, right.target)) &&
      (left.kind === "native-alias" || closedMetadataEquals(left, right)) }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    register(walk: RustFactWalk, declaration: Node): void {
      assertOpen();
      const selected = selectRustTypeAliasDeclaration(walk, declaration);
      if (selected !== undefined) family.writer.set(declaration, selected);
    },
  });
}
