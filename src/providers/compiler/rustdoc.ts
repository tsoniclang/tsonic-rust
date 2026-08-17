import type {
  RustCompilerDependency,
  RustCompilerModuleModel,
  RustCompilerProjectSnapshot,
} from "./model.js";
import { verifyRustCompilerDependencySource } from "./cargo-snapshot.js";
import {
  loadRustdocDocument,
  validateDependencyBelongsToSnapshot,
} from "./rustdoc-artifact.js";
import { normalizeModule } from "./rustdoc-model.js";
import {
  collectModuleStandardTypeLocations,
  loadStandardLibraryContext,
  loadStandardLibraryCrateDocument,
  resolveStandardLibraryItem,
} from "./rustdoc-standard-library.js";

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
    standardTypeLocations: Object.freeze(collectModuleStandardTypeLocations(
      normalized,
      standardLibrary,
    )),
  });
  verifyRustCompilerDependencySource(options.snapshot, options.dependency);
  return model;
}
