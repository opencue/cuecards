# Rust Development Guidance Skill

A Claude Code skill that provides consistent guidance for Rust development, including code style, error handling, testing, and build verification.

## Overview

This skill is automatically applied when Claude Code detects work with Rust code, `Cargo.toml` files, or cargo commands. It ensures consistent coding standards and best practices across Rust projects.

## Features

The skill provides guidance on:

- **Code Style** - Standard Rust conventions, rustfmt formatting, descriptive naming
- **Crate-Level Lints** - Configuring clippy with `pedantic` lints in `lib.rs`
- **Error Handling** - Using `Result` with `?`, `thiserror` for libraries, `anyhow` for applications
- **Logging** - Using the `log` crate instead of `println!`
- **Documentation** - Comprehensive rustdoc requirements for all items
- **Testing** - Unit and integration test patterns
- **Build Verification** - Ordered checks: fmt, clippy, test, build, doc, deny, audit
- **Dependencies** - Minimising dependencies with `default-features = false`
- **Security** - cargo-deny for licenses, cargo-audit for vulnerabilities

## Installation

Place this skill in your Claude Code skills directory:

```text
~/.claude/skills/londey-rust-guidance/
├── SKILL.md
└── README.md
```

## Usage

The skill activates automatically when working with Rust projects. You can also invoke it manually:

```text
/rust
```

## Allowed Tools

This skill has access to:

- `Read` - Reading source files
- `Grep` - Searching code
- `Bash` - Running cargo commands

## License

MIT
