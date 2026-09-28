import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, createSourceSemanticsExtension, TstsSourceProviderContractVersion } from "@tsonic/tsts";
import { createTsonicCoreSourceExtension, tsonicCoreSourceSemanticsModules } from "@tsonic/source-core";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core/extension";
import { tsonicAttributeBuilderFactKey } from "@tsonic/source-core/facts";
import { createSourceReferenceNavigation, createTargetSourceProgram, sourceProjectFiles } from "@tsonic/target-api/source";
import { createRustAttributeApplicationFactIndex } from "../../../dist/analysis/attributes/application-index.js";

function attributeSource(invocation) {
  const captures = [];
  const checked = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/subject.ts": `
        export class Subject {
          value: number = 1;
          run(): number { return this.value; }
        }
        export function calculate(value: number): number { return value; }
      `,
      "/src/index.ts": `
        import { attribute } from "@tsonic/core/lang.js";
        import { Subject as Selected, calculate as evaluate } from "./subject.js";
        import * as subjects from "./subject.js";
        import { annotate as native } from "@test/native/attributes.js";
        class Annotation {}
        attribute<Selected>().add(${invocation});
        attribute<subjects.Subject>().property(subject => subject.value).add(${invocation});
        attribute<Selected>().method(subject => subject.run).add(${invocation});
        attribute<typeof evaluate>().add(${invocation});
        attribute.module().add(${invocation});
      `,
    },
    compilerOptions: { strict: true, target: "es2022", module: "esnext" },
    extensionHostOptions: { extensions: [
      createSourceSemanticsExtension({ modules: tsonicCoreSourceSemanticsModules() }),
      createTsonicCoreSourceExtension(),
      {
        identity: { id: "test.rust-attribute-demand", version: "1" },
        dependencies: { dependsOn: [tsonicCoreSourceExtensionId] },
        initialize(context) {
          context.registerSourceDeclarationProvider({
            identity: { id: "test.native-attribute", version: "1", extensionContractVersion: TstsSourceProviderContractVersion },
            declarationMaterialization: "complete",
            ownsModule: specifier => ({ kind: specifier === "@test/native/attributes.js" ? "owned" : "unowned" }),
            resolveModule: specifier => ({ kind: "virtual", moduleSpecifier: specifier,
              providerModuleId: "Native.Attributes", virtualFileName: "/provider/attributes.d.ts" }),
            getDeclarationModel: () => ({ moduleSpecifier: "@test/native/attributes.js", providerModuleId: "Native.Attributes",
              exports: [{ id: "Native.Annotate", name: "annotate", kind: "intrinsic" }] }),
          });
        },
        elaborateSource(context) {
          const sourceFiles = sourceProjectFiles(context.source);
          const facts = [];
          const input = {
            ast: context.source.ast,
            sourceFiles,
            navigation: createSourceReferenceNavigation(context.source, sourceFiles),
            sourceFacts: {
              getFact(subject, key) {
                assert.equal(key, tsonicAttributeBuilderFactKey);
                const fact = subject === undefined ? undefined : context.factResolver.resolve(subject, key);
                if (fact?.kind === "application") facts.push(fact);
                return fact;
              },
            },
          };
          const index = createRustAttributeApplicationFactIndex(input);
          assert.equal(facts.length, 5);
          assert.equal("program" in context.source, false);
          assert.equal("semantics" in input, false);
          assert.deepEqual(Object.keys(input.sourceFacts), ["getFact"]);
          const subjectFile = context.source.getSourceFile("/src/subject.ts");
          const classDeclaration = input.ast.statements(subjectFile).find(node => input.ast.is.IsClassDeclaration(node));
          const functionDeclaration = input.ast.statements(subjectFile).find(node => input.ast.is.IsFunctionDeclaration(node));
          assert.ok(classDeclaration);
          assert.ok(functionDeclaration);
          const field = input.ast.members(classDeclaration).find(node => input.ast.is.IsPropertyDeclaration(node));
          const method = input.ast.members(classDeclaration).find(node => input.ast.is.IsMethodDeclaration(node));
          assert.ok(field);
          assert.ok(method);
          const targets = [classDeclaration, field, method, functionDeclaration, context.source.getSourceFile("/src/index.ts")];
          for (const [position, target] of targets.entries()) {
            const selected = index.forDeclaration(target);
            assert.equal(selected.length, 1);
            assert.equal(selected[0], facts[position]);
            assert.equal(Object.isFrozen(selected), true);
          }
          captures.push({ targets, facts });
        },
      },
    ] },
  }).checkSource();
  assert.deepEqual(checked.extensionDiagnostics, []);
  assert.ok(captures.length > 0);
  const latest = captures[captures.length - 1];
  const finalized = createRustAttributeApplicationFactIndex(createTargetSourceProgram(checked));
  for (const [position, target] of latest.targets.entries()) {
    assert.equal(finalized.forDeclaration(target)[0], latest.facts[position]);
  }
  return checked;
}

test("Rust attribute declaration selection reuses exact shared demands before and after checking", () => {
  const checked = attributeSource("() => new Annotation()");
  assert.deepEqual(checked.diagnostics, []);
});

test("native attribute input can be collected without claiming its unimplemented native checking succeeded", () => {
  const checked = attributeSource("() => native(ignoredToken)");
  assert.ok(checked.diagnostics.some(diagnostic => diagnostic?.code === 2349));
  assert.ok(checked.diagnostics.some(diagnostic => diagnostic?.code === 2304));
});
