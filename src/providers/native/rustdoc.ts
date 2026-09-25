import type {
  RustCompilerDependency,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
} from "./model/model.js";
import { verifyRustCompilerDependencySource } from "./snapshot/cargo-snapshot.js";
import {
  validateDependencyBelongsToSnapshot,
  type RustdocDocumentLoader,
} from "./snapshot/rustdoc-artifact.js";
import { normalizeModule } from "./model/rustdoc-model.js";
import {
  collectModuleStandardTypeLocations,
  loadStandardLibraryContext,
  loadStandardLibraryCrateDocument,
  resolveStandardLibraryItem,
} from "./projection/standard-library.js";
import type { RustFoundation } from "../../target-model/foundation/model.js";

export function loadRustCompilerModule(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly standardLibrarySnapshot: RustCompilerProjectSnapshot;
  readonly standardLibraryTargetDirectory: string;
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly requestedExports?: readonly string[];
  readonly targetDirectory: string;
  readonly foundation: RustFoundation;
  readonly loadDocument: RustdocDocumentLoader;
}): RustCompilerModuleModel {
  validateDependencyBelongsToSnapshot(options.snapshot, options.dependency);
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  const standardLibrary = loadStandardLibraryContext(
    options.standardLibrarySnapshot,
    options.standardLibraryTargetDirectory,
    options.loadDocument,
  );
  const standardModule = options.snapshot.digest === options.standardLibrarySnapshot.digest;
  const document = standardModule
    ? loadStandardLibraryCrateDocument(standardLibrary, options.dependency)
    : options.loadDocument(options);
  const normalized = normalizeModule(document, options, standardModule
    ? (itemDocument, dependency, id) =>
        resolveStandardLibraryItem(standardLibrary, itemDocument, dependency, id)
    : undefined);
  const model = Object.freeze({
    ...normalized,
    standardTypeLocations: Object.freeze(collectModuleStandardTypeLocations(
      normalized,
      standardLibrary,
      options.foundation,
    )),
  });
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  return model;
}
