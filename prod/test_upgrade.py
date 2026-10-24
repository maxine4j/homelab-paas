"""Hermetic production upgrade checks; no Docker daemon or root required."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SHA = "b" * 40


class UpgradeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.etc = self.root / "etc"
        self.etc.mkdir()
        self.compose = self.etc / "docker-compose.yaml"
        self.compose.write_text("old-compose\n")
        for name in ("config.yaml", "envoy.yaml", "env/service.env"):
            path = self.etc / name
            path.parent.mkdir(exist_ok=True)
            path.write_text("keep-secret\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("bash", "mktemp", "rm", "sed", "install", "cp", "mkdir"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.executable("id", "#!/bin/sh\nprintf '0\\n'\n")
        self.executable("git", """#!/bin/sh
if [ "$1" = clone ]; then
    [ "$2" = --depth ] && [ "$3" = 1 ] && [ "$4" = --single-branch ] && [ "$5" = --branch ] && [ "$6" = main ] && [ "$7" = https://github.com/maxine4j/homelab-paas ] || exit 98
    [ "${TEST_FAIL:-}" != clone ] || exit 1
    for arg do destination=$arg; done
    printf '%s' "$destination" > "$TEST_CHECKOUT"
    mkdir -p "$destination/prod/etc/homelab-paas"
    cp "$TEST_TEMPLATE" "$destination/prod/etc/homelab-paas/docker-compose.yaml"
elif [ "$1" = -C ] && [ "$3" = rev-parse ] && [ "$4" = HEAD ]; then
    printf '%s\\n' "$TEST_SHA"
else
    exit 99
fi
""")
        self.executable("docker", """#!/bin/bash
[[ "$1" == compose && "$2" == -f ]] || exit 98
file=$3
shift 3
[[ -f "$file" ]] || exit 97
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$*" in
    'config --quiet') ;;
    down) [[ $(< "$file") == old-compose ]] || exit 96 ;;
    'up -d') [[ $(< "$file") == *"ghcr.io/maxine4j/homelab-paas:$TEST_SHA"* ]] || exit 95 ;;
    *) exit 94 ;;
esac
[[ "${TEST_FAIL:-}" != "$1" ]]
""")
        self.env = {
            **os.environ,
            "PATH": str(self.bin),
            "TEST_TEMPLATE": str(ROOT / "prod/etc/homelab-paas/docker-compose.yaml"),
            "TEST_SHA": SHA,
            "TEST_LOG": str(self.root / "docker.log"),
            "TEST_CHECKOUT": str(self.root / "checkout-path"),
        }

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o700)

    def run_upgrade(self):
        script = (ROOT / "prod/upgrade-paas.sh").read_text().replace(
            "config_dir=/etc/homelab-paas", "config_dir=" + str(self.etc)
        )
        return subprocess.run(
            [str(self.bin / "bash")], input=script, text=True,
            env=self.env, capture_output=True, timeout=10,
        )

    def commands(self):
        path = self.root / "docker.log"
        return path.read_text().splitlines() if path.exists() else []

    def assert_checkout_removed(self):
        path = self.root / "checkout-path"
        if path.exists():
            self.assertFalse(Path(path.read_text()).exists())

    def test_replaces_only_compose_with_latest_main_sha_and_restarts(self):
        result = self.run_upgrade()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = Path(self.env["TEST_TEMPLATE"]).read_text().replace(
            "replace-with-release-tag-or-commit-sha", SHA
        )
        self.assertEqual(self.compose.read_text(), expected)
        self.assertEqual(self.compose.stat().st_mode & 0o777, 0o600)
        for name in ("config.yaml", "envoy.yaml", "env/service.env"):
            self.assertEqual((self.etc / name).read_text(), "keep-secret\n")
        self.assertEqual(self.commands(), ["config --quiet", "down", "up -d"])
        self.assert_checkout_removed()

    def test_preparation_failures_leave_running_installation_untouched(self):
        for failure in ("clone", "config"):
            with self.subTest(failure=failure):
                self.env["TEST_FAIL"] = failure
                result = self.run_upgrade()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.compose.read_text(), "old-compose\n")
                self.assertNotIn("down", self.commands())
                self.assert_checkout_removed()

    def test_invalid_revision_fails_before_stopping(self):
        self.env["TEST_SHA"] = "not-a-sha"
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.commands(), [])
        self.assertEqual(self.compose.read_text(), "old-compose\n")
        self.assert_checkout_removed()

    def test_missing_image_placeholder_fails_before_stopping(self):
        template = self.root / "invalid.yaml"
        template.write_text("services: {}\n")
        self.env["TEST_TEMPLATE"] = str(template)
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.commands(), [])
        self.assertEqual(self.compose.read_text(), "old-compose\n")
        self.assert_checkout_removed()

    def test_down_failure_does_not_replace_compose_or_start(self):
        self.env["TEST_FAIL"] = "down"
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.compose.read_text(), "old-compose\n")
        self.assertEqual(self.commands(), ["config --quiet", "down"])
        self.assert_checkout_removed()

    def test_up_failure_is_reported_and_checkout_removed(self):
        self.env["TEST_FAIL"] = "up"
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(SHA, self.compose.read_text())
        self.assert_checkout_removed()

    def test_nonroot_or_missing_installation_fails_before_clone(self):
        self.executable("id", "#!/bin/sh\nprintf '1000\\n'\n")
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sudo", result.stderr)
        self.executable("id", "#!/bin/sh\nprintf '0\\n'\n")
        self.compose.unlink()
        result = self.run_upgrade()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "checkout-path").exists())
        self.assertEqual(self.commands(), [])


if __name__ == "__main__":
    unittest.main()
