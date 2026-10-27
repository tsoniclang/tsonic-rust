import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import { setCarrierFact } from "../operations/project-calls.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";
import type { RustNativeEnumDeclaration } from "../../target-model/records/native/native-value-declarations.js";
import { selectRustEnumConstantRepresentation } from "../../policy/types/project/enum-constant-admission.js";

export function recordEnumFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast, names, source, typeDefinitions } = walk.context;
  const name = names.nameForDeclaration(declaration);
  if (name === undefined || !isValidRustIdentifier(name)) {
    appendRustDiagnostic(walk, "RUST_DECLARATION_NAME_NOT_CLOSED",
      "An emitted native declaration requires its exact preserved Rust identifier.", declaration,
      ["target.capability=rust.declaration.native-form"]);
    return;
  }
  const members = ast.members(declaration);
  if (!isDenseDataArray(members) || members.some(member => member === undefined)) {
    appendRustDiagnostic(walk, "RUST_SOURCE_AST_INCOMPLETE",
      "Enum declaration contains an undefined member slot.", declaration, ["target.capability=rust.declaration.native-form"]);
    return;
  }
  const width = source.semantics.enumConstants.integerWidth(declaration);
  if (width === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "A checked source enum has no completed shared integer-width selection.", declaration);
  if (width.kind === "rejected") {
    appendRustDiagnostic(walk, width.failure === "resource" ? "RUST_ENUM_CONSTANT_RESOURCE_LIMIT"
      : "RUST_ENUM_CONSTANT_NOT_SUPPORTED", width.reason, width.member, ["target.capability=rust.declaration.native-form"]);
    return;
  }
  const values: bigint[] = [];
  const variants: RustNativeEnumDeclaration["variants"][number][] = [];
  for (const member of members as readonly Node[]) {
    const memberName = names.nameForDeclaration(member);
    if (memberName === undefined || !isValidRustIdentifier(memberName)) {
      appendRustDiagnostic(walk, "RUST_ENUM_MEMBER_NAME_NOT_CLOSED",
        "Enum member names must be valid Rust identifiers.", member, ["target.capability=rust.declaration.native-form"]);
      return;
    }
    const constant = source.semantics.enumConstants.get(member);
    if (constant?.kind !== "resolved" || typeof constant.value !== "bigint") {
      failTargetAnalysisInvariant("tsonic-rust",
        "A resolved shared enum width requires every identical member's completed integer constant.", member);
    }
    values.push(constant.value);
    variants.push(Object.freeze({ declaration: member, name: memberName, discriminant: constant.value.toString() }));
  }
  const carrier = walk.sourceTypes.carrierForDeclaration(declaration);
  if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust",
    "A registered source enum has no nominal carrier before physical type initialization.", declaration);
  const definition: RustNativeEnumDeclaration = Object.freeze({ kind: "enum", name,
    integerWidth: width.integerWidth, representation: selectRustEnumConstantRepresentation(values),
    variants: Object.freeze(variants) });
  if (!typeDefinitions.registerSourceEnum(carrier, definition)) failTargetAnalysisInvariant("tsonic-rust",
    "A source enum requires one complete native definition from its sole early producer.", declaration);
  setCarrierFact(walk, declaration, carrier);
}
