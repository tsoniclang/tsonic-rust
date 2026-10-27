import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustNativeDeclarationForm, RustNativeDeclarationForms } from "../../../../target-model/records/native/native-declaration-forms.js";
import type { RustRecordFamily } from "../../../../target-model/records/program.js";
import { createRustRecordFamily } from "../family.js";

export interface RustNativeDeclarationProducer {
  readonly declarations: RustRecordFamily<RustNativeDeclarationForm>;
  readonly implementations: RustRecordFamily<RustNativeDeclarationForms["implementations"]>;
  interface(declaration: Node, form: Extract<RustNativeDeclarationForm, { readonly kind: "interface" }>): void;
  publish(ast: AstReader, nodes: readonly Node[], sourceFiles: readonly SourceFile[], forms: RustNativeDeclarationForms): void;
}

export function createRustNativeDeclarationProducer(assertOpen: () => void): RustNativeDeclarationProducer {
  let published = false;
  const declarations = createRustRecordFamily<RustNativeDeclarationForm>({ id: "tsonic.rust.nativeDeclaration", equals: (left, right) => left === right }, assertOpen);
  const implementations = createRustRecordFamily<RustNativeDeclarationForms["implementations"]>({ id: "tsonic.rust.nativeTypeFamilyImplementations", equals: (left, right) => left === right }, assertOpen);
  return Object.freeze({ declarations: declarations.reader, implementations: implementations.reader,
    interface(declaration: Node, form: Extract<RustNativeDeclarationForm, { readonly kind: "interface" }>): void {
      assertOpen();
      if (published) failTargetAnalysisInvariant("tsonic-rust", "Native interface fields admit before final declaration publication.", declaration);
      declarations.writer.set(declaration, form);
    },
    publish(ast: AstReader, nodes: readonly Node[], sourceFiles: readonly SourceFile[], forms: RustNativeDeclarationForms): void {
      assertOpen();
      if (published) failTargetAnalysisInvariant("tsonic-rust", "Native declaration records publish exactly once.");
      published = true;
      for (const node of nodes) {
        const form = forms.get(node);
        if (form?.kind === "interface") {
          if (declarations.reader.get(node) !== form) failTargetAnalysisInvariant("tsonic-rust",
            "Native declaration publication retains the identical early interface field admission.", node);
        } else if (form !== undefined) declarations.writer.set(node, form);
      }
      for (const sourceFile of sourceFiles) implementations.writer.set(sourceFile,
        Object.freeze(forms.implementations.filter(row => row.implementation.sourceFileName === ast.getFileName(sourceFile))));
    },
  });
}
