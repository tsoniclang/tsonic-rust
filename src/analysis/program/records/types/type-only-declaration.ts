import { requireRustRecord } from "../objects/required-records.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustProgramRecords } from "../../../../target-model/records/program.js";
import { rustSourceTypeDeclarations } from "../../../project-types/source-declarations.js";
import { selectRustInterfaceRepresentationAlias } from "../../../declarations/interface-aliases.js";
import { checkRustAmbientVariableUses, rustAmbientVariableDeclarations, selectRustTypeOnlyDeclaration } from "../../../declarations/type-only.js";
import { setCarrierFact } from "../../../operations/project-calls.js";
import { appendRustDiagnostic } from "../../walk.js";
import type { RustFactWalk } from "../../walk.js";
import { createRustRecordFamily } from "../family.js";

type RustTypeOnlyDeclaration = Exclude<ReturnType<RustProgramRecords["typeOnlyDeclaration"]["get"]>, undefined>;

export interface RustTypeOnlyDeclarationProducer {
  readonly records: RustProgramRecords["typeOnlyDeclaration"];
  statement(walk: RustFactWalk, statement: Node): RustTypeOnlyDeclaration | undefined;
  finalize(walk: RustFactWalk, files: readonly SourceFile[]): void;
  representationAliases(walk: RustFactWalk, files: readonly SourceFile[]): void;
}

export function createRustTypeOnlyDeclarationProducer(
  assertOpen: () => void,
  inherited?: RustProgramRecords["typeOnlyDeclaration"],
): RustTypeOnlyDeclarationProducer {
  const family = createRustRecordFamily<RustTypeOnlyDeclaration>({ id: "tsonic.rust.typeOnlyDeclaration",
    equals: (left, right) => left.reason === right.reason }, assertOpen, inherited);
  const finalizedStatements = new WeakSet<Node>();
  const representedWalks = new WeakMap<Node, RustFactWalk>();
  const recordReason = (subject: Node, reason: RustTypeOnlyDeclaration["reason"]): void => {
    const existing = family.reader.get(subject);
    if (existing !== undefined && existing.reason !== reason) failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.typeOnlyDeclaration' for one exact source subject.");
    if (existing === undefined) family.writer.set(subject, { reason });
  };
  const finalizeStatement = (walk: RustFactWalk, statement: Node, families: ReadonlySet<Node>): RustTypeOnlyDeclaration | undefined => {
    if (finalizedStatements.has(statement)) return family.reader.get(statement);
    const reason = selectRustTypeOnlyDeclaration(walk, statement, families);
    if (reason === undefined) return family.reader.get(statement);
    requireRustRecord(walk.context.requiredRecords, "typeOnlyDeclaration", statement, reason, "typeOnlyDeclarations.finalize");
    recordReason(statement, reason);
    if (reason === "ambient") for (const declaration of rustAmbientVariableDeclarations(walk, statement)) {
      checkRustAmbientVariableUses(walk, declaration);
      requireRustRecord(walk.context.requiredRecords, "typeOnlyDeclaration", declaration, reason, "typeOnlyDeclarations.finalize");
      recordReason(declaration, reason);
    }
    finalizedStatements.add(statement);
    return family.reader.get(statement);
  };
  return Object.freeze({
    records: family.reader,
    statement(walk: RustFactWalk, statement: Node): RustTypeOnlyDeclaration | undefined {
      assertOpen();
      return walk.context.ast.is.IsVariableStatement(statement)
        ? finalizeStatement(walk, statement, new Set()) : family.reader.get(statement);
    },
    finalize(walk: RustFactWalk, files: readonly SourceFile[]): void {
      assertOpen();
      const families = new Set(walk.context.typeFamilies.families().flatMap(selected =>
        selected.kind === "conditional" ? [selected.declaration] : []));
      for (const file of files) for (const statement of walk.context.ast.statements(file)) {
        if (statement === undefined) failTargetAnalysisInvariant("tsonic-rust", "Type-only declaration analysis received an incomplete checked source file.", file);
        finalizeStatement(walk, statement, families);
      }
    },
    representationAliases(walk: RustFactWalk, files: readonly SourceFile[]): void {
      assertOpen();
      const { ast } = walk.context;
      const visiting = new Set<Node>();
      const visited = new Set<Node>();
      const rejected = new Set<Node>();
      for (const file of files) for (const declaration of rustSourceTypeDeclarations(file, ast, walk.context.isNativeNode)) visit(declaration);

      function visit(declaration: Node): boolean {
        if (rejected.has(declaration)) return false;
        if (visited.has(declaration) || representedWalks.get(declaration) === walk ||
          ast.kindName(declaration) !== "KindInterfaceDeclaration") return true;
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
        const declarations = new Set(selection.declarations);
        const pending: Node[] = [];
        for (const merged of declarations) {
          if (selection.registrationCarrier !== undefined &&
            (!walk.sourceTypes.registerRepresentationAlias(merged, selection.registrationCarrier) ||
              setCarrierFact(walk, merged, selection.registrationCarrier) === undefined)) {
            appendRustDiagnostic(walk, "RUST_INTERFACE_REPRESENTATION_CONFLICT",
              "Merged interfaces require one exact native representation.", merged, []);
            return false;
          }
          requireRustRecord(walk.context.requiredRecords, "typeOnlyDeclaration", merged,
            "representation-alias", "typeOnlyDeclarations.representationAliases");
          const existing = family.reader.get(merged);
          if (existing !== undefined && existing.reason !== "representation-alias") failTargetAnalysisInvariant("tsonic-rust",
            "Conflicting Rust semantic plan 'tsonic.rust.typeOnlyDeclaration' for one exact source subject.");
          if (existing === undefined) pending.push(merged);
        }
        for (const merged of pending) family.writer.set(merged, { reason: "representation-alias" });
        for (const merged of declarations) {
          visited.add(merged);
          representedWalks.set(merged, walk);
        }
        return true;
      }
    },
  });
}
