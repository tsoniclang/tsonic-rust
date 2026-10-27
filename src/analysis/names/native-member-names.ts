import type { AstReader, Node } from "@tsonic/tsts";
import { rustProjectMemberIsPrivate } from "../project-types/member-privacy.js";
import type { RustClassEmissionProducer } from "../program/records/objects/class-emission.js";

export function analyzeRustNativeMemberVisibility(
  ast: AstReader, declarations: readonly Node[], producer: Pick<RustClassEmissionProducer, "visibility">,
): void {
  for (const declaration of new Set(declarations)) {
    const privateMember = rustProjectMemberIsPrivate(ast, declaration);
    producer.visibility(declaration, { public: privateMember ? "private" : "public", internal: privateMember ? "private" : "crate" });
  }
}
