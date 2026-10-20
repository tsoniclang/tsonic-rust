import type { AstReader, Node } from "@tsonic/tsts";

export type RustSourceProfileKind = "native" | "js";

export interface RustSourceProfileRegistry {
  profileForNode(
    node: Node,
    ast: AstReader,
  ): RustSourceProfileKind | undefined;
}
