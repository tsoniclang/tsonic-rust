# JS/Node lane inventory relative to the C# target surface

Classification of JS/Node lanes reviewed against the C# target surface.
The machine-checked list lives in docs/parity-lanes.json; every listed
lane carries exactly one classification — implemented (positive runtime
proof in the generated Cargo bank), hard-rejected (architecture;
zero-artifact proof), or blocked by a named contract — and the guard test
keeps this document and the lane list from drifting. C# lanes without
Rust rows (Object helpers, Number helpers, console, bare
module aliases, Date extras, process and buffer extras) are enumerated in
the blocked section with the contract each requires.

## Implemented

- Array: literals, index/at, length, push, includes, indexOf, map,
  filter, reduce, some, every, find, findIndex, findLast, findLastIndex;
  slice over closed Clone carriers and join over exact stringifiable carriers;
  sparse lane via JsArray.
- String: length, toUpperCase, toLowerCase, includes, startsWith,
  endsWith, indexOf, slice, at, charAt, codePointAt, repeat, padStart,
  padEnd, trim, trimStart, trimEnd, concat via +, split, replace, search,
  match; String.matchAll call and fallibility lowering for constant
  patterns (consuming the returned match list is a blocked lane below).
- RegExp: constant literals and new RegExp with literal arguments over the
  oracle-proven subset; test, replace, split, search, global match with
  null coalescing; regexp property reads.
- Math: floor, ceil, trunc, abs, sqrt, pow (exact f64 semantics).
- Number.isNaN, Number.isFinite, Number.isInteger and Number.isSafeInteger
  over exact numeric carriers; non-number unknown values fail closed without
  coercion.
- JSON: parse, stringify, stringify with null replacer and closed numeric
  or string space, over the closed JsValue carrier.
- Map, Set: constructors, get/set/has/delete/add, size, SameValueZero.
  Set algebra rows (union, intersection, difference, symmetricDifference,
  isSubsetOf, isSupersetOf, isDisjointFrom) are runtime-proven and lower
  when project lib settings expose the declarations.
- Date: UTC carrier constructors, now, parse, UTC, getTime, valueOf,
  toISOString, toJSON, UTC getters.
- Node: path, os, fs, fs/promises (async signatures over synchronous file
  operations), process (cwd, exit, value exports, env with null-preserving
  reads, fallible execPath property), Buffer, URL, URLSearchParams, legacy
  url.parse/format with the UrlObject carrier, crypto (randomUUID,
  randomBytes, createHash, createHmac), util (closed string helpers,
  inspect over closed JsValue, format with closed placeholders), and
  node:assert `ok` with optional string messages.
- Error model, async/await, callbacks, tuples, fixed arrays, records,
  string-literal unions, generics, statics — see README.

## Hard-rejected by architecture

- Open reflection and dynamic member access; eval and embedded engines.
- Dynamic RegExp patterns and constructs outside the oracle subset (lazy
  quantifiers, backreferences, lookaround, named groups, word-boundary
  assertions, unicode property escapes, flags d s u v y).
- JSON replacer functions and custom toJSON dispatch.
- Math lanes whose Rust semantics differ from JS (round, min, max, random).
- Process termination side effects beyond exit(code).

## Blocked by named external contracts

- discriminated object unions (narrowing): requires public TSTS narrowing
  facts
  (repro pinned in test/r8-completion.test.mjs).
- localeCompare, locale case conversion, normalization: requires an ICU
  contract.
- Local-timezone Date lanes: requires a tzdata contract.
- streams and fs.watch, event subscriptions: requires stream and event
  carrier
  contracts.
- Fixed-size arrays beyond homogeneous tuples: requires source-core
  length facts.
- RegExp exec and non-global match result consumption (the match-result
  carrier and its member rows exist): requires optional-chaining or
  option-narrowing lanes for nullable object results.
- String.matchAll result consumption: requires iterator carrier lanes
  (the call and fallibility lowering are implemented).
- Object.keys/values/entries, Object.assign, Object.hasOwn, Object.is:
  requires closed-shape reflection rows over the JsValue carrier.
- Number.parseInt/parseFloat, toFixed and formatting: requires exact numeric
  parsing and formatting rows in the js runtime.
- console.log/error/warn/info: requires a console/stdio carrier contract.
- Date UTC setters, remaining string methods, and local-time getters and
  setters:
  requires date-mutation and tzdata contracts.
- bare module aliases (fs as an alias of node:fs): requires a
  module-alias ownership contract.
- process extras (argv0, hrtime, memoryUsage, stdio) and buffer extras
  (copy, slice views, swap, typed reads): requires process-runtime and
  byte-view carrier contracts.
