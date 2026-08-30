import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from repomix_batch import (  # noqa: E402
    RepomixBatchProcessor,
    RepomixConfig,
    ensure_references_output_dir,
    load_repositories_from_file,
    main,
)


class RepomixBatchTests(unittest.TestCase):
    def test_ensure_references_output_dir_allows_general_references(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            target = base / "process/general-plans/references"
            target.mkdir(parents=True)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                resolved = ensure_references_output_dir("process/general-plans/references")
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(resolved, target.resolve())

    def test_ensure_references_output_dir_allows_feature_references(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            target = base / "process/features/workflows/references"
            target.mkdir(parents=True)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                resolved = ensure_references_output_dir("process/features/workflows/references")
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(resolved, target.resolve())

    def test_ensure_references_output_dir_rejects_non_reference_dir(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "tmp").mkdir()

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                with self.assertRaises(ValueError):
                    ensure_references_output_dir("tmp")
            finally:
                os.chdir(previous_cwd)

    def test_build_command_local_uses_pnpm_dlx(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                config = RepomixConfig(style="markdown", remove_comments=True)
                processor = RepomixBatchProcessor(config)
                command = processor._build_command(".", Path("out.md"), is_remote=False)
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(command[:3], ["pnpm", "dlx", "repomix"])
            self.assertIn(".", command)
            self.assertIn("--remove-comments", command)

    def test_build_command_remote_uses_remote_flag(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                processor = RepomixBatchProcessor(RepomixConfig())
                command = processor._build_command("owner/repo", Path("out.xml"), is_remote=True)
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(command[:3], ["pnpm", "dlx", "repomix"])
            self.assertIn("--remote", command)
            self.assertIn("owner/repo", command)

    @patch("subprocess.run")
    def test_check_repomix_installed_uses_pnpm_dlx(self, mock_run):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)
            mock_run.return_value = Mock(returncode=0)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                processor = RepomixBatchProcessor(RepomixConfig())
                result = processor.check_repomix_installed()
            finally:
                os.chdir(previous_cwd)

        self.assertTrue(result)
        self.assertEqual(mock_run.call_args[0][0], ["pnpm", "dlx", "repomix", "--version"])

    @patch("subprocess.run")
    def test_process_repository_success(self, mock_run):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)
            mock_run.return_value = Mock(returncode=0, stdout="ok", stderr="")

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                processor = RepomixBatchProcessor(RepomixConfig())
                success, message = processor.process_repository(".")
            finally:
                os.chdir(previous_cwd)

        self.assertTrue(success)
        self.assertIn("Successfully processed", message)

    @patch("subprocess.run")
    def test_process_repository_failure(self, mock_run):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)
            mock_run.return_value = Mock(returncode=1, stdout="", stderr="boom")

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                processor = RepomixBatchProcessor(RepomixConfig())
                success, message = processor.process_repository(".")
            finally:
                os.chdir(previous_cwd)

        self.assertFalse(success)
        self.assertIn("boom", message)

    @patch("subprocess.run")
    def test_process_repository_timeout(self, mock_run):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)
            mock_run.side_effect = subprocess.TimeoutExpired(cmd=[], timeout=300)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                processor = RepomixBatchProcessor(RepomixConfig())
                success, message = processor.process_repository(".")
            finally:
                os.chdir(previous_cwd)

        self.assertFalse(success)
        self.assertIn("Timeout", message)

    def test_load_repositories_from_file_valid(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_file = Path(tmp_dir) / "repos.json"
            config_file.write_text(json.dumps([{"path": ".", "remote": False}]), encoding="utf-8")

            self.assertEqual(
                load_repositories_from_file(str(config_file)),
                [{"path": ".", "remote": False}],
            )

    def test_load_repositories_from_file_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_file = Path(tmp_dir) / "repos.json"
            config_file.write_text("{not json", encoding="utf-8")

            self.assertEqual(load_repositories_from_file(str(config_file)), [])

    @patch("sys.argv", ["repomix_batch.py", "."])
    @patch.object(RepomixBatchProcessor, "check_repomix_installed", return_value=True)
    @patch.object(RepomixBatchProcessor, "process_batch", return_value={"success": ["ok"], "failed": []})
    def test_main_success(self, mock_process_batch, mock_check):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "process/general-plans/references").mkdir(parents=True)

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                result = main()
            finally:
                os.chdir(previous_cwd)

        self.assertEqual(result, 0)
        mock_check.assert_called_once()
        mock_process_batch.assert_called_once()

    @patch("sys.argv", ["repomix_batch.py", "--output-dir", "tmp", "."])
    def test_main_rejects_non_references_output_dir(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            base = Path(tmp_dir)
            (base / "tmp").mkdir()

            previous_cwd = Path.cwd()
            os.chdir(base)
            try:
                result = main()
            finally:
                os.chdir(previous_cwd)

        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()
