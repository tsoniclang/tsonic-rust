import type { AstReader, Node } from "@tsonic/tsts";

import type { RustSourceProfileErrorContract } from "../../../target-model/records/program/source-profiles.js";

export type RustSourceProfileKind = "native" | "js";

export interface RustSourceProfileRegistry {
  errorForDeclaration(declaration: Node): RustSourceProfileErrorContract | undefined;
  profileForNode(
    node: Node,
    ast: AstReader,
  ): RustSourceProfileKind | undefined;
}
