#!/usr/bin/env python3
"""Post-edit schema validation hook for Claude Code.

Validates JSON-LD schema after file edits. Returns exit code 2 to block
if critical validation errors found. Ported from AgriciDaniel/claude-seo.
"""

import json
import re
import sys
import os
from typing import List


def validate_jsonld(content: str) -> List[str]:
    """Validate JSON-LD blocks in HTML content."""
    errors = []
    pattern = r'<script\s+type=["\']application/ld\+json["\']\s*>(.*?)</script>'
    blocks = re.findall(pattern, content, re.DOTALL | re.IGNORECASE)

    if not blocks:
        return []

    for i, block in enumerate(blocks, 1):
        block = block.strip()
        try:
            data = json.loads(block)
        except json.JSONDecodeError as e:
            errors.append(f"Block {i}: Invalid JSON; {e}")
            continue

        if isinstance(data, list):
            for item in data:
                errors.extend(_validate_schema_object(item, i))
        elif isinstance(data, dict):
            errors.extend(_validate_schema_object(data, i))

    return errors


def _validate_schema_object(obj: dict, block_num: int) -> List[str]:
    """Validate a single schema object."""
    errors = []
    prefix = f"Block {block_num}"

    if "@context" not in obj:
        errors.append(f"{prefix}: Missing @context")
    elif obj["@context"] not in ("https://schema.org", "http://schema.org"):
        errors.append(f"{prefix}: @context should be 'https://schema.org'")

    if "@type" not in obj:
        errors.append(f"{prefix}: Missing @type")

    placeholders = [
        "[Business Name]", "[City]", "[State]", "[Phone]", "[Address]",
        "[Your", "[INSERT", "REPLACE", "[URL]", "[Email]",
    ]
    text = json.dumps(obj)
    for p in placeholders:
        if p.lower() in text.lower():
            errors.append(f"{prefix}: Contains placeholder text: {p}")

    schema_type = obj.get("@type", "")
    deprecated = {
        "HowTo": "deprecated September 2023",
        "SpecialAnnouncement": "deprecated July 31, 2025",
        "CourseInfo": "retired June 2025",
        "EstimatedSalary": "retired June 2025",
        "LearningVideo": "retired June 2025",
        "ClaimReview": "retired June 2025; fact-check rich results discontinued",
        "VehicleListing": "retired June 2025; vehicle listing structured data discontinued",
    }
    if schema_type in deprecated:
        errors.append(f"{prefix}: @type '{schema_type}' is {deprecated[schema_type]}")

    # FAQPage intentionally NOT flagged: Google retired FAQ rich results (May 2026)
    # but markup still aids AI Mode / AI Overviews entity resolution.

    return errors


def main():
    if len(sys.argv) < 2:
        sys.exit(0)

    filepath = sys.argv[1]

    if not os.path.isfile(filepath):
        sys.exit(0)

    valid_extensions = (".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".php", ".ejs")
    if not filepath.lower().endswith(valid_extensions):
        sys.exit(0)

    MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MiB
    try:
        if os.path.getsize(filepath) > MAX_FILE_BYTES:
            sys.exit(0)
    except OSError:
        sys.exit(0)

    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except (OSError, IOError):
        sys.exit(0)

    errors = validate_jsonld(content)

    if not errors:
        sys.exit(0)

    critical_keywords = ["placeholder", "deprecated", "retired"]
    critical = [e for e in errors if any(kw in e.lower() for kw in critical_keywords)]
    warnings = [e for e in errors if e not in critical]

    if warnings:
        print("⚠️  Schema validation warnings:")
        for w in warnings:
            print(f"  - {w}")

    if critical:
        print("🛑 Schema validation ERRORS (blocking):")
        for e in critical:
            print(f"  - {e}")
        sys.exit(2)

    sys.exit(1)


if __name__ == "__main__":
    main()
