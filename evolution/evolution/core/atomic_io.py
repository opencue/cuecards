"""Atomic file write — temp file in the same dir + os.replace (POSIX-atomic).

Guarantees a file is either fully its old content or fully the new content,
never a truncated partial write if the process is interrupted (SIGKILL,
disk-full) mid-write. Used for every mutation of a tracked file (SKILL.md,
profile.yaml) so an aborted run can't corrupt it.
"""

import os
import tempfile
from pathlib import Path


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as fh:
            fh.write(text)
        os.replace(tmp, path)  # atomic rename
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
