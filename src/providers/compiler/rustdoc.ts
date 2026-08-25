import type {
  RustCompilerDependency,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
} from "./model/model.js";
import { verifyRustCompilerDependencySource } from "./snapshot/cargo-snapshot.js";
import {
  loadRustdocDocument,
  validateDependencyBelongsToSnapshot,
} from "./snapshot/rustdoc-artifact.js";
import { normalizeModule } from "./model/rustdoc-model.js";
import {
  collectModuleStandardItemLocations,
  loadStandardLibraryContext,
  loadStandardLibraryCrateDocument,
  resolveStandardLibraryItem,
} from "./projection/standard-library.js";

export function loadRustCompilerModule(options: {
  readonly snapshot: RustCompilerProjectSnapshot;
  readonly standardLibrarySnapshot: RustCompilerProjectSnapshot;
  readonly standardLibraryTargetDirectory: string;
  readonly dependency: RustCompilerDependency;
  readonly modulePath: readonly string[];
  readonly requestedExports?: readonly string[];
  readonly targetDirectory: string;
}): RustCompilerModuleModel {
  validateDependencyBelongsToSnapshot(options.snapshot, options.dependency);
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  const standardLibrary = loadStandardLibraryContext(
    options.standardLibrarySnapshot,
    options.standardLibraryTargetDirectory,
  );
  const standardModule = options.snapshot.digest === options.standardLibrarySnapshot.digest;
  const document = standardModule
    ? loadStandardLibraryCrateDocument(standardLibrary, options.dependency)
    : loadRustdocDocument(options);
  const normalized = normalizeModule(document, options, standardModule
    ? (itemDocument, dependency, id) =>
        resolveStandardLibraryItem(standardLibrary, itemDocument, dependency, id)
    : undefined);
  const model = Object.freeze({
    ...normalized,
    standardItemLocations: Object.freeze(collectModuleStandardItemLocations(
      normalized,
      standardLibrary,
    )),
  });
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  return model;
}
