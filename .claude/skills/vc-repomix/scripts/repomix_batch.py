#!/usr/bin/env python3
"""
Batch process multiple repositories with Repomix using Flowser-safe defaults.
"""

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ALLOWED_REFERENCE_ROOTS = (
    Path("process/general-plans/references"),
    Path("process/features"),
)


@dataclass
class RepomixConfig:
    style: str = "xml"
    output_dir: str = "process/general-plans/references"
    remove_comments: bool = False
    include_pattern: str | None = None
    ignore_pattern: str | None = None
    no_security_check: bool = False
    verbose: bool = False
    use_local_binary: bool = False


def ensure_references_output_dir(output_dir: str):
    candidate = Path(output_dir).expanduser()
    resolved = candidate.resolve(strict=False)
    general_root = Path("process/general-plans/references").resolve(strict=False)
    features_root = Path("process/features").resolve(strict=False)

    in_general = resolved == general_root or general_root in resolved.parents
    in_feature = features_root in resolved.parents and "references" in resolved.parts

    if in_general or in_feature:
        return resolved

    raise ValueError(
        "Output directory must be inside process/general-plans/references "
        "or process/features/*/references"
    )


class RepomixBatchProcessor:
    def __init__(self, config: RepomixConfig):
        self.config = config
        self.output_dir = ensure_references_output_dir(config.output_dir)

    def check_repomix_installed(self):
        command = ["repomix", "--version"] if self.config.use_local_binary else ["pnpm", "dlx", "repomix", "--version"]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.SubprocessError):
            return False

    def process_repository(self, repo_path: str, output_name: str | None = None, is_remote: bool = False):
        self.output_dir.mkdir(parents=True, exist_ok=True)

        if output_name:
            output_file = self.output_dir / output_name
        else:
            repo_name = self._repo_slug(repo_path, is_remote)
            output_file = self.output_dir / f"{repo_name}-output.{self._get_extension(self.config.style)}"

        command = self._build_command(repo_path, output_file, is_remote)

        if self.config.verbose:
            print(f"Executing: {' '.join(command)}")

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, f"Timeout processing {repo_path} (exceeded 5 minutes)"
        except Exception as error:
            return False, f"Error processing {repo_path}: {error}"

        if result.returncode == 0:
            return True, f"Successfully processed {repo_path} -> {output_file}"

        error_message = result.stderr or result.stdout or "Unknown error"
        return False, f"Failed to process {repo_path}: {error_message}"

    def _build_command(self, repo_path: str, output_file: Path, is_remote: bool):
        base = ["repomix"] if self.config.use_local_binary else ["pnpm", "dlx", "repomix"]

        if is_remote:
            base.extend(["--remote", repo_path])
        else:
            base.append(repo_path)

        base.extend(["--style", self.config.style, "-o", str(output_file)])

        if self.config.remove_comments:
            base.append("--remove-comments")

        if self.config.include_pattern:
            base.extend(["--include", self.config.include_pattern])

        if self.config.ignore_pattern:
            base.extend(["-i", self.config.ignore_pattern])

        if self.config.no_security_check:
            base.append("--no-security-check")

        if self.config.verbose:
            base.append("--verbose")

        return base

    def process_batch(self, repositories: list[dict[str, object]]):
        results = {"success": [], "failed": []}

        for repo in repositories:
            repo_path = repo.get("path")
            if not repo_path or not isinstance(repo_path, str):
                results["failed"].append("Missing 'path' in repository config")
                continue

            output_name = repo.get("output")
            if output_name is not None and not isinstance(output_name, str):
                results["failed"].append(f"Invalid output value for {repo_path}")
                continue

            is_remote = bool(repo.get("remote", False))
            success, message = self.process_repository(repo_path, output_name, is_remote)

            if success:
                results["success"].append(message)
            else:
                results["failed"].append(message)

            print(message)

        return results

    @staticmethod
    def _get_extension(style: str):
        extensions = {
            "xml": "xml",
            "markdown": "md",
            "json": "json",
            "plain": "txt",
        }
        return extensions.get(style, "xml")

    @staticmethod
    def _repo_slug(repo_path: str, is_remote: bool):
        if is_remote:
            normalized = repo_path.rstrip("/").split("/")[-2:]
            return "-".join(part.replace(".", "-") for part in normalized)

        return Path(repo_path).resolve(strict=False).name.replace(".", "-")


def load_repositories_from_file(file_path: str):
    try:
        with open(file_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as error:
        print(f"Error: Invalid JSON in {file_path}: {error}", file=sys.stderr)
        return []
    except Exception as error:
        print(f"Error: Failed to read {file_path}: {error}", file=sys.stderr)
        return []

    if isinstance(data, list):
        return data

    print(f"Error: Expected array in {file_path}", file=sys.stderr)
    return []


def main():
    parser = argparse.ArgumentParser(
        description="Batch process multiple repositories with Flowser-safe repomix defaults"
    )
    parser.add_argument("repos", nargs="*", help="Repository paths or owner/repo values")
    parser.add_argument("-f", "--file", help="JSON file containing repository configurations")
    parser.add_argument(
        "--style",
        choices=["xml", "markdown", "json", "plain"],
        default="xml",
        help="Output format (default: xml)",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        default="process/general-plans/references",
        help="Output directory inside a Flowser references folder",
    )
    parser.add_argument("--remove-comments", action="store_true", help="Remove comments from source files")
    parser.add_argument("--include", help="Include pattern (glob)")
    parser.add_argument("--ignore", help="Ignore pattern (glob)")
    parser.add_argument(
        "--no-security-check",
        action="store_true",
        help="Disable security checks only for documented false positives",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--remote", action="store_true", help="Treat positional repos as remote")
    parser.add_argument(
        "--use-local-binary",
        action="store_true",
        help="Use an already-installed repomix binary instead of pnpm dlx repomix",
    )

    args = parser.parse_args()

    try:
        config = RepomixConfig(
            style=args.style,
            output_dir=args.output_dir,
            remove_comments=args.remove_comments,
            include_pattern=args.include,
            ignore_pattern=args.ignore,
            no_security_check=args.no_security_check,
            verbose=args.verbose,
            use_local_binary=args.use_local_binary,
        )
        processor = RepomixBatchProcessor(config)
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    if not processor.check_repomix_installed():
        print("Error: repomix is not installed or pnpm dlx repomix is unavailable", file=sys.stderr)
        print("Check with: pnpm dlx repomix --version", file=sys.stderr)
        return 1

    repositories: list[dict[str, object]] = []

    if args.file:
        repositories.extend(load_repositories_from_file(args.file))

    for repo_path in args.repos:
        repositories.append({"path": repo_path, "remote": args.remote})

    if not repositories:
        print("Error: No repositories specified", file=sys.stderr)
        print("Use: repomix_batch.py <repo1> <repo2> ...", file=sys.stderr)
        print("Or: repomix_batch.py -f repos.json", file=sys.stderr)
        return 1

    print(f"Processing {len(repositories)} repositories...")
    results = processor.process_batch(repositories)

    print("\n" + "=" * 50)
    print(f"Success: {len(results['success'])}")
    print(f"Failed: {len(results['failed'])}")

    if results["failed"]:
        print("\nFailed repositories:")
        for failure in results["failed"]:
            print(f"  - {failure}")

    return 0 if not results["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
