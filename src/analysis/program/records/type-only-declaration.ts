import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustProgramRecords } from "../../../target-model/records/program.js";
import { rustSourceTypeDeclarations } from "../../../policy/types/model/source-declarations.js";
import { selectRustInterfaceRepresentationAlias } from "../../declarations/interface-aliases.js";
import { checkRustAmbientVariableUses, rustAmbientVariableDeclarations, selectRustTypeOnlyDeclaration } from "../../declarations/type-only.js";
import { setCarrierFact } from "../../operations/project-calls.js";
import { appendRustDiagnostic } from "../walk.js";
import type { RustFactWalk } from "../walk.js";
import { createRustRecordFamily } from "./family.js";

type RustTypeOnlyDeclaration = Exclude<ReturnType<RustProgramRecords["typeOnlyDeclaration"]["get"]>, undefined>;

export interface RustTypeOnlyDeclarationProducer {
  readonly records: RustProgramRecords["typeOnlyDeclaration"];
  finalize(walk: RustFactWalk, files: readonly SourceFile[]): void;
  representationAliases(walk: RustFactWalk, files: readonly SourceFile[]): void;
}

export function createRustTypeOnlyDeclarationProducer(
  assertOpen: () => void,
  inherited?: RustProgramRecords["typeOnlyDeclaration"],
): RustTypeOnlyDeclarationProducer {
  const family = createRustRecordFamily<RustTypeOnlyDeclaration>({ id: "tsonic.rust.typeOnlyDeclaration",
    equals: (left, right) => left.reason === right.reason }, assertOpen, inherited);
  return Object.freeze({
    records: family.reader,
    finalize(walk: RustFactWalk, files: readonly SourceFile[]): void {
      assertOpen();
      const families = new Set(walk.context.typeFamilies.families().flatMap(selected =>
        selected.kind === "conditional" ? [selected.declaration] : []));
      for (const file of files) for (const statement of walk.context.ast.statements(file)) {
        if (statement === undefined) throw new Error("Type-only declaration analysis received an incomplete checked source file.");
        const reason = selectRustTypeOnlyDeclaration(walk, statement, families);
        if (reason === undefined) continue;
        family.writer.set(statement, { reason });
        if (reason !== "ambient") continue;
        for (const declaration of rustAmbientVariableDeclarations(walk, statement)) {
          checkRustAmbientVariableUses(walk, declaration);
          family.writer.set(declaration, { reason });
        }
      }
    },
    representationAliases(walk: RustFactWalk, files: readonly SourceFile[]): void {
      assertOpen();
      const { ast } = walk.context;
      const visiting = new Set<Node>();
      const visited = new Set<Node>();
      const rejected = new Set<Node>();
      for (const file of files) for (const declaration of rustSourceTypeDeclarations(file, ast)) visit(declaration);

      function visit(declaration: Node): boolean {
        if (rejected.has(declaration)) return false;
        if (ast.kindName(declaration) !== "KindInterfaceDeclaration" || visited.has(declaration)) return true;
        if (visiting.has(declaration)) {
          rejected.add(declaration);
          appendRustDiagnostic(walk, "RUST_INTERFACE_REPRESENTATION_CYCLE",
            "Recursive interface facades require a closed recursive representation, not an erased native alias.", declaration, []);
          return false;
        }
        visiting.add(declaration);
        const accepted = classify(declaration);
        visiting.delete(declaration);
        visited.add(declaration);
        if (!accepted) rejected.add(declaration);
        return accepted;
      }

      function classify(declaration: Node): boolean {
        const selection = selectRustInterfaceRepresentationAlias(walk, declaration, visit);
        if (selection === false) return false;
        if (selection === undefined) return true;
        for (const merged of selection.declarations) {
          if (selection.registrationCarrier !== undefined &&
            (!walk.sourceTypes.registerRepresentationAlias(merged, selection.registrationCarrier) ||
              setCarrierFact(walk, merged, selection.registrationCarrier) === undefined)) {
            appendRustDiagnostic(walk, "RUST_INTERFACE_REPRESENTATION_CONFLICT",
              "Merged interfaces require one exact native representation.", merged, []);
            return false;
          }
          family.writer.set(merged, { reason: "representation-alias" });
        }
        return true;
      }
    },
  });
}
