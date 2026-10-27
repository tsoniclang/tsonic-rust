import type { Node } from "@tsonic/tsts";
import { analyzeSourceArtifactFiles } from "@tsonic/target-api/analysis";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourceArtifactProducer } from "../program/records/program/artifacts.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";

export function analyzeRustSourceArtifacts(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceArtifactProducer): readonly TargetDiagnostic[] {
  const selected = analyzeSourceArtifactFiles({ ast: program.source.ast, sourceFiles: program.sourceFiles,
    navigation: program.sourceNavigation, constructions: program.sourceModuleConstructions.entries() });
  const issues: TargetDiagnostic[] = selected.issues.map(issue => ({
    category: "error", source: "tsonic-rust", sourceNode: issue.sourceFile,
    code: issue.kind === "source-identity" ? "RUST_SOURCE_FILE_ARTIFACT_IDENTITY_MISSING"
      : issue.kind === "source-conflict" ? "RUST_SOURCE_FILE_ARTIFACT_IDENTITY_CONFLICT"
      : issue.kind === "module-identity" ? "RUST_SOURCE_FILE_DEPENDENCY_IDENTITY_MISSING"
      : "RUST_SOURCE_MODULE_DEPENDENCY_IDENTITY_MISSING",
    message: issue.kind === "source-identity" ? "One project source file has no stable compiler-owned identity for Rust artifact reconstruction."
      : issue.kind === "source-conflict" ? `Multiple project source files resolve to Rust artifact owner '${issue.owner}'.`
      : issue.kind === "module-identity" ? `A project module referenced by '${issue.owner}' has no stable Rust artifact identity.`
      : `A source module constructed by '${issue.owner}' has no stable Rust artifact identity.`,
  }));
  const items = new Map<string, string>();
  const emitted = new Set<string>();
  const add = (fileName: string, name: string | undefined): void => {
    if (name === undefined) return;
    const identity = program.sourceOutputIdentities.get(fileName);
    if (identity === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native item requires its selected source module identity.");
    const key = rustSourceItemIdentity(fileName, name);
    emitted.add(key);
    if (identity.externalCrateName !== undefined)
      items.set(key, `${identity.externalCrateName}::${identity.moduleName}::${name}`);
  };
  for (const node of nodes) {
    const file = program.source.ast.getSourceFile(node);
    if (file === undefined) continue;
    const fileName = program.source.ast.getFileName(file);
    const binding = program.records.sourceBindingEmission.get(node);
    if (binding?.scope === "module") add(binding.fileName, binding.name);
    const variable = program.records.moduleBindingEmission.get(node);
    if (variable !== undefined) add(fileName, variable.name);
    const exported = program.records.defaultExport.get(node);
    if (exported !== undefined) add(fileName, exported.name);
    const declaration = program.records.nativeDeclaration.get(node);
    if (declaration !== undefined && program.records.typeOnlyDeclaration.get(node) === undefined) add(fileName, declaration.name);
    const callable = program.records.callableDeclaration.get(node);
    if (callable !== undefined && program.records.nativeParticipation.get(node) !== "erased") {
      add(fileName, callable.name);
      add(fileName, callable.nativeBody?.name);
      for (const variant of callable.specializations) { add(fileName, variant.targetName); add(fileName, variant.nativeBodyName); }
    }
    const method = program.records.methodDeclaration.get(node);
    if (method?.isStatic) for (const variant of method.variants) add(fileName, variant.moduleName);
    const environment = program.records.classEnvironment.get(node);
    if (environment !== undefined) add(fileName, environment.environment.typeName);
    const classValue = program.records.classValueModule.get(node);
    if (classValue !== undefined) add(fileName, classValue.environment.bindingName);
  }
  for (const file of program.sourceFiles) {
    const fileName = program.source.ast.getFileName(file);
    const module = program.records.sourceFileEmission.get(file);
    if (module?.initialization.required) add(fileName, program.records.sourcePackageInitializers.get()?.functionNameByFileName.get(fileName));
    for (const { definition, local } of module?.classes ?? []) {
      // A local class is named through its scope module path, which is how other crates refer to its source type.
      if (local) add(fileName, definition.targetPath);
      add(fileName, definition.targetName); add(fileName, definition.stateName);
      add(fileName, definition.dispatchName); add(fileName, definition.rootName);
    }
    const generics = program.records.genericDeclarations.get(file);
    for (const implementation of generics?.implementations ?? []) {
      add(fileName, implementation.stateName); add(fileName, implementation.functionName);
    }
    for (const definition of generics?.definitions ?? []) {
      add(fileName, definition.targetName); add(fileName, definition.nativeFutureDispatchName);
    }
    for (const protocol of program.records.nativeProtocols.get(file) ?? []) if (protocol.ownerFileName === fileName) {
      add(fileName, protocol.targetName); add(fileName, protocol.boundProducerName);
    }
    for (const definition of program.records.frameDeclarations.get(file) ?? []) {
      add(fileName, definition.targetName); add(fileName, program.records.frameDeclaration.get(definition)?.counterName);
      for (const entry of definition.entries) {
        add(fileName, entry.targetName);
        for (const implementation of entry.implementations) {
          add(fileName, implementation.stateName); add(fileName, implementation.functionName);
        }
      }
    }
    for (const implementation of program.records.suspendedDeclarations.get(file) ?? []) add(fileName, implementation.stateName);
  }
  const facades = program.records.sourcePackageFacades.get();
  if (facades === undefined) failTargetAnalysisInvariant("tsonic-rust", "Source linkage requires its sealed native facade inventory.");
  for (const [identity, path] of facades.externalItemPathByIdentity) {
    if (!emitted.has(identity)) issues.push({ code: "RUST_SOURCE_PACKAGE_LINKAGE_ITEM_MISSING", category: "error", source: "tsonic-rust",
      message: "An external source-package facade names an item absent from its exact planned Rust implementation." });
    else items.set(identity, path);
  }
  if (issues.length === 0) producer.publish(selected.files, items);
  return Object.freeze(issues);
}
