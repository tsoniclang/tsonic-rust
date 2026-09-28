import assert from "node:assert/strict";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createSourceSemanticsVirtualModuleProvider } from "@tsonic/source-core/extension";
import { rustSyntaxIntrinsicDeclarations } from "../../dist/source/semantics/declarations/syntax.js";
import { rustLangModule, rustSourceProviderVersion, rustSourceSemanticsExtensionId,
  rustSourceVirtualModulesProviderId } from "../../dist/source/semantics/identity.js";

const core = ["Object", "Function", "CallableFunction", "NewableFunction", "IArguments", "String", "Number", "Boolean", "RegExp"]
  .map(name => `interface ${name} {}`).join("\n") + "\ninterface Array<T> { [index:number]:T; length:number; }";

export function createRustSourceSyntax(sourceText, { modules = [], files = {} } = {}) {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: { "/src/core.d.ts": core, ...files, "/src/index.ts": sourceText },
    compilerOptions: { noLib: true, module: "esnext", target: "esnext" },
    extensionHostOptions: { extensions: [{
      identity: { id: rustSourceSemanticsExtensionId, version: rustSourceProviderVersion },
      initialize(context) {
        context.registerSourceDeclarationProvider(createSourceSemanticsVirtualModuleProvider({
          id: rustSourceVirtualModulesProviderId,
          version: rustSourceProviderVersion,
          displayName: "Rust syntax declarations",
          virtualDirectory: "rust-source",
          modules: [{ moduleSpecifier: rustLangModule, packageName: "@tsonic/rust", subpath: "lang.js", exports: [] }],
          exportsForModule: rustSyntaxIntrinsicDeclarations,
          evidenceMessage: "Rust syntax declaration identity under test.",
        }));
        for (const [index, module] of modules.entries()) {
          context.registerSourceDeclarationProvider(createSourceSemanticsVirtualModuleProvider({
            id: module.id,
            version: "1",
            displayName: module.id,
            virtualDirectory: `native-test-${index}`,
            modules: [{ moduleSpecifier: module.moduleSpecifier, packageName: module.id, subpath: "index.js", exports: [] }],
            exportsForModule: () => module.exports,
            evidenceMessage: "Provider reference under test.",
          }));
        }
      },
    }] },
  });
  assert.deepEqual(session.getDiagnostics("syntactic"), []);
  const source = session.checkSource();
  const ast = source.ast;
  const file = source.getSourceFile("/src/index.ts");
  const queries = source.getSourceFileQueries(file);
  const nodes = [];
  const visit = node => {
    if (node === undefined) return;
    nodes.push(node);
    ast.forEachChild(node, visit);
  };
  visit(file);
  return { session, source, ast, file, queries, nodes };
}
