---
name: Codex-skill-rust
description: Guide for Rust development including code style, testing, building, and quality checks using cargo tools. Apply when working with Rust code, Cargo.toml, or running cargo commands.
user-invocable: true
allowed-tools: Read, Grep, Bash
---

# Rust Development Guide

## Code Style

- Follow standard Rust conventions and idioms
- Use `rustfmt` for code formatting
- Configure lints in `lib.rs` (see Crate-Level Lint Configuration below)
- Prefer descriptive variable and function names

## Module File Organization

Prefer the modern `<module_name>.rs` style over the legacy `mod.rs` style for module files.

**Preferred (modern style):**

```text
src/
├── lib.rs
├── config.rs        # mod config
├── config/
│   └── parser.rs    # mod config::parser
├── network.rs       # mod network
└── network/
    ├── client.rs    # mod network::client
    └── server.rs    # mod network::server
```

**Avoid (legacy style):**

```text
src/
├── lib.rs
├── config/
│   ├── mod.rs       # mod config
│   └── parser.rs    # mod config::parser
└── network/
    ├── mod.rs       # mod network
    ├── client.rs    # mod network::client
    └── server.rs    # mod network::server
```

Benefits of the modern style:

- File names directly indicate the module name (no ambiguous `mod.rs` files)
- Easier navigation in editors and file browsers
- Clear correspondence between module path and file path
- Supported since Rust 2018 edition

## Crate-Level Lint Configuration

Define lint rules at the top of `lib.rs` (or `main.rs` for binaries) rather than via command-line flags. This ensures consistent enforcement and documents project standards.

```rust
#![deny(unsafe_code)]
#![cfg_attr(all(not(debug_assertions), not(test)), deny(clippy::all))]
#![cfg_attr(all(not(debug_assertions), not(test)), deny(clippy::pedantic))]
#![cfg_attr(all(not(debug_assertions), not(test)), deny(missing_docs))]
// Allow some pedantic lints that are too strict for this project
#![allow(clippy::module_name_repetitions)]
#![allow(clippy::must_use_candidate)]
#![allow(clippy::missing_errors_doc)]
#![allow(clippy::missing_panics_doc)]
#![allow(clippy::enum_variant_names)]
// Until 1.0.0, allow dead code and unused dependency warnings
#![allow(dead_code)]
#![allow(unused_crate_dependencies)]

```

Key principles:

- Deny `unsafe_code` unless explicitly required
- Use `cfg_attr` to deny lints only in release builds (not debug or test)
- Allow specific pedantic lints that conflict with project conventions
- Document why each `allow` is necessary

**Important**: These are good defaults for new crates. Do not override existing lint configurations - if a crate already specifies `deny` or `allow` for a rule, respect that choice.

## Error Handling

Avoid `.unwrap()` and `.expect()` - these cause panics and should not be used in production code. Instead:

- Use `Result<T, E>` return types with the `?` operator for error propagation
- Prefer early returns for error conditions
- Handle errors explicitly at appropriate boundaries

### Error Type Crates

**Note**: The following recommendations apply to `std` crates only. For `no_std` embedded targets, use custom error enums or `thiserror` with `default-features = false`.

- **Libraries**: Use `thiserror` to define custom error types with derive macros
- **Applications**: Use `anyhow` for convenient error handling with context

Example library error type with `thiserror`:

```rust
use thiserror::Error;

/// Errors that can occur during data processing.
#[derive(Debug, Error)]
pub enum ProcessError {
    /// The input data was empty.
    #[error("input data cannot be empty")]
    EmptyInput,

    /// Failed to parse the input data.
    #[error("failed to parse input: {0}")]
    ParseFailure(String),

    /// An I/O error occurred.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}
```

Example application error handling with `anyhow`:

```rust
use anyhow::{Context, Result};

fn load_config(path: &Path) -> Result<Config> {
    let contents = std::fs::read_to_string(path)
        .context("failed to read config file")?;

    let config: Config = serde_json::from_str(&contents)
        .context("failed to parse config JSON")?;

    Ok(config)
}
```

## Logging

**Note**: The following recommendations apply to `std` crates only. For `no_std` embedded targets, use `defmt` or platform-specific logging mechanisms.

Avoid `println!` and `eprintln!` outside of main application entry points. Use the `log` crate for structured logging instead.

```rust
use log::{debug, info, warn, error};

fn process_data(data: &[u8]) -> Result<(), ProcessError> {
    debug!("Processing {} bytes", data.len());

    if data.is_empty() {
        warn!("Received empty data buffer");
        return Err(ProcessError::EmptyInput);
    }

    info!("Data processed successfully");
    Ok(())
}
```

Log levels:

- `error!` - Unrecoverable errors or failures
- `warn!` - Unexpected conditions that are handled
- `info!` - Significant events in normal operation
- `debug!` - Detailed information for debugging
- `trace!` - Very detailed tracing information

Applications should initialise a log implementation (e.g., `env_logger`, `tracing-subscriber`) in `main()`.

## Whitespace and Formatting

Maintain blank lines for readability:

- Between module-level items (functions, structs, enums, traits, constants, impl blocks)
- Between struct and enum members when they have doc comments
- Between constant declarations
- After `use` statements before the first item
- After code blocks (loops, conditionals, match arms) before subsequent statements

### Struct Field Formatting

When struct or enum fields have documentation comments, add a blank line before each doc comment to visually separate the fields:

```rust
pub struct Handle<T> {
    /// Index into the arena's resource vector.
    index: usize,

    /// Generation counter to detect stale handles after resource reuse.
    generation: u32,

    /// Type marker to prevent mixing handles of different resource types.
    _marker: PhantomData<T>,
}
```

For fields without documentation, blank lines are optional but may still aid readability for complex types.

## Documentation

All items require rustdoc documentation comments.

For documenting the following item (functions, types, constants, fields):

```rust
/// Documentation for the item below.
```

For documenting the enclosing item (modules, crate root):

```rust
//! Documentation for the containing module.
```

Items requiring documentation include:

- Functions and methods
- Types (structs, enums, type aliases)
- Traits and trait implementations
- Constants and statics
- Modules
- Test functions
- Struct and enum fields

### Function Documentation

Function documentation must include:

- Brief description of purpose
- `# Arguments` section documenting each parameter
- `# Returns` section documenting the return value
- `# Errors` section if the function returns `Result`
- `# Panics` section if the function can panic

Example:

```rust
/// Calculates the checksum for the given data buffer.
///
/// # Arguments
///
/// * `data` - The byte slice to calculate the checksum for.
/// * `seed` - Initial seed value for the checksum algorithm.
///
/// # Returns
///
/// The computed 32-bit checksum value.
///
/// # Errors
///
/// Returns `ChecksumError::EmptyBuffer` if `data` is empty.
fn calculate_checksum(data: &[u8], seed: u32) -> Result<u32, ChecksumError> {
    // ...
}
```

### Constant Documentation

Constant documentation must include:

- Description of the constant's purpose
- Reference to specification, document, or section where applicable

Example:

```rust
/// Maximum transmission unit size in bytes.
///
/// Per RFC 894, Section 3 - Ethernet frames have a maximum payload of 1500 bytes.
const MTU_SIZE: usize = 1500;
```

## Testing

- Write unit tests in the same file as the code being tested
- Use integration tests in the `tests/` directory for end-to-end functionality
- Run tests with `cargo test`
- Aim for meaningful test coverage of core functionality
- Document test functions with their purpose and what they verify

## Build Verification

After completing changes to Rust code, run the following checks in order:

1. **Format Code**: `cargo fmt`
2. **Format Check**: `cargo fmt --check`
3. **Lint Check**: `cargo clippy -- -D warnings`
4. **Tests**: `cargo test`
5. **Release Build**: `cargo build --release`
6. **Documentation**: `cargo doc --no-deps --document-private-items`
7. **License Check**: `cargo deny check`
8. **Security Audit**: `cargo audit`

If any check fails, fix the issues before proceeding.

## Security Tools

Projects should use these security tools:

- **cargo-deny**: License and advisory checker. Install with `cargo install cargo-deny`. Configuration in `deny.toml` enforces permissive licenses (MIT, Apache-2.0, BSD) and denies copyleft licenses (GPL, LGPL, AGPL).

- **cargo-audit**: Security vulnerability scanner. Install with `cargo install cargo-audit`. Scans dependencies against the RustSec Advisory Database.

## Dependencies

When adding dependencies:

- Choose well-maintained crates widely used in the Rust ecosystem
- For workspaces, add shared dependencies to `[workspace.dependencies]` in root `Cargo.toml`
- Justify each dependency with a clear use case
- Disable default features and explicitly enable only required features

### Minimising Dependencies

Always add dependencies with `default-features = false` and explicitly specify the features you need. This reduces compile times and binary size by avoiding unnecessary transitive dependencies.

```toml
# Prefer this:
serde = { version = "1.0", default-features = false, features = ["derive"] }

# Avoid this:
serde = "1.0"
```

When adding a new dependency:

1. Check the crate's documentation for available features
2. Identify the minimum set of features required for your use case
3. Add with `default-features = false`
4. Explicitly list only the features you need
