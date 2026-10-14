import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { sourceFileIdentity } from "@tsonic/target-api/source";
import type { RustSafetyApplication, RustSafetyApplicationFactIndex } from "../../target-model/records/safety.js";

export interface RustSafetyAdmissionInput {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly safety: Pick<RustSafetyApplicationFactIndex, "findings">;
}

export interface RustSafetyAdmissionIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export function admitRustSafetyApplications(input: RustSafetyAdmissionInput): readonly RustSafetyAdmissionIssue[] {
  const issues: RustSafetyAdmissionIssue[] = [];
  const sourceFiles = [...input.sourceFiles].sort((left, right) =>
    (sourceFileIdentity(input.ast, left) ?? "").localeCompare(sourceFileIdentity(input.ast, right) ?? "", "en"));
  for (const sourceFile of sourceFiles) {
    const findings = input.safety.findings.get(sourceFile);
    for (const conflict of findings.conflicts) {
      issue(conflict.first.sourceSubject, "RUST_SAFETY_CONTRACT_CONFLICT",
        "One exact Rust declaration received conflicting finalized safe and requires-unsafe contracts.");
    }
    for (const { application, status } of findings.applications) {
      if (status === "target-not-resolved") {
        issue(application.sourceSubject, "RUST_SAFETY_APPLICATION_TARGET_NOT_RESOLVED",
          "The finalized safety application has no exact emitted Rust declaration target.");
      } else if (status === "candidate") {
        admitCandidate(application);
      }
    }
  }
  return Object.freeze(issues);

  function admitCandidate(application: RustSafetyApplication): void {
    if (application.contract === "safe") {
      issue(application.sourceSubject, "RUST_SAFE_DECLARATION_TARGET_UNSUPPORTED",
        "Rust 'safe' is not an explicit modifier on ordinary function declarations; the selected source declaration has no Rust boundary where this contract can be emitted.");
    } else if (!hasRustUnsafeBoundary(application)) {
      issue(application.sourceSubject, "RUST_SAFETY_APPLICATION_TARGET_UNSUPPORTED",
        "The selected source declaration has no emitted Rust function boundary that can carry an explicit unsafe contract.");
    }
  }

  function hasRustUnsafeBoundary(application: RustSafetyApplication): boolean {
    return application.targetDeclarations.some((declaration) => {
      const kind = input.ast.kindName(declaration);
      if (application.applicationPlacement === "constructor") {
        return kind === "KindClassDeclaration" || kind === "KindConstructor" || kind === "KindConstructorDeclaration";
      }
      if (application.applicationPlacement === "getter") return kind === "KindGetAccessor";
      if (application.applicationPlacement === "setter") return kind === "KindSetAccessor";
      if (application.applicationPlacement !== "declaration") return false;
      return kind === "KindFunctionDeclaration" || kind === "KindMethodDeclaration" || kind === "KindMethodSignature";
    });
  }

  function issue(node: Node, code: string, message: string): void {
    issues.push(Object.freeze({ node, code, message }));
  }
}
