import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { ClassStaticBlock_Body, Node_Initializer } from "@tsonic/target-api/source";
import { rustProjectStaticFieldStorage } from "./object-layout.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../policy/constraints/native-traits.js";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustClassInitializationEntry } from "../../target-model/records/objects/class-initialization.js";
import type { RustClassInitializationProducer } from "../program/records/objects/class-initialization.js";

export function analyzeRustClassInitialization(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "records" | "projectTypes" | "typeDefinitions" | "classValues" | "safetyApplications">;
  readonly nodes: readonly Node[];
  readonly producer: RustClassInitializationProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: node, message,
      evidence: [`target.capability=${capability}`] });
  };
  for (const node of input.nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    if (!ast.is.IsClassDeclaration(node) && !ast.is.IsClassExpression(node) || program.records.nativeUnreachable.get(node) === true ||
      program.records.compileTimeSource.get(node) !== undefined || program.records.nativeParticipation.get(node) === "erased") continue;
    const entries: RustClassInitializationEntry[] = [];
    const environment = program.classValues.forDeclaration(node)?.environment;
    const local = environment !== undefined && ast.parent(environment.declaration) !== ast.getSourceFile(environment.declaration) ? environment : undefined;
    for (const member of ast.members(node)) {
      if (member === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class initialization requires dense checked member declarations.", node);
      if (ast.is.IsClassStaticBlockDeclaration(member)) {
        const body = ClassStaticBlock_Body(ast, member);
        if (body === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class static block requires its checked source body.", member);
        entries.push(Object.freeze({ kind: "block", declaration: member, body }));
        continue;
      }
      const storage = rustProjectStaticFieldStorage(member, ast, program.projectTypes.memberSlotName(member, "static"));
      if (storage === undefined) continue;
      const initializer = Node_Initializer(ast, member);
      if (initializer === undefined) {
        refuse(member, "rust.backend.static-field-initializer", "Rust static class fields require an initializer so their runtime value is exact.");
        continue;
      }
      const carrier = program.records.runtimeCarrier.get(member)?.carrier;
      if (carrier === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted static class field requires its finalized native value carrier.", member);
      if (!rustCarrierSupportsClone(carrier, program.typeDefinitions)) {
        refuse(member, "rust.backend.static-field-carrier", "Rust static class fields require one exact Clone-capable value carrier.");
        continue;
      }
      entries.push(Object.freeze({ kind: "field", declaration: member, initializer, carrier, name: storage.targetName }));
      const field = local?.staticFields.find(field => field.declaration === member);
      if (local !== undefined && field === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted local static field requires its exact native environment slot.", member);
      input.producer.field(member, { copy: isRustCopyCarrier(carrier), environment: field === undefined || local === undefined ? undefined
        : Object.freeze({ declaration: local.declaration, name: field.fieldName, readonly: field.readonly }) });
    }
    input.producer.classDeclaration(node, entries);
  }
  return Object.freeze(issues);
}
