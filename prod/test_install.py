"""Hermetic installer checks: python3 -m unittest discover -s prod -p 'test_*.py'."""

import errno
import json
import os
from pathlib import Path
import pty
import select
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
SHA = "a" * 40
SETTINGS = ("platform.example.net", "platform-admin", "admin@example.net")
TOKEN = 'do-token: "quoted" \\ value'


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.etc = self.root / "etc"
        self.var = self.root / "var"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        for name in ("bash", "install", "mkdir", "rm", "stty", "od", "tr", "sed"):
            (self.bin / name).symlink_to(shutil.which(name))
        self.executable("id", "#!/bin/sh\nprintf '0\\n'\n")
        self.executable("git", """#!/bin/sh
if [ "$1" = clone ]; then
    [ "$2" = --depth ] && [ "$3" = 1 ] && [ "$4" = --single-branch ] && [ "$5" = --branch ] && [ "$6" = main ] && [ "$7" = https://github.com/maxine4j/homelab-paas ] || exit 98
    for arg do destination=$arg; done
    mkdir -p "$destination/prod/etc/homelab-paas"
    cp "$TEST_TEMPLATES/"* "$destination/prod/etc/homelab-paas/"
elif [ "$1" = -C ]; then
    printf '%s\\n' "$TEST_SHA"
else
    exit 99
fi
""")
        (self.bin / "cp").symlink_to(shutil.which("cp"))
        self.env = {
            **os.environ,
            "PATH": str(self.bin),
            "TEST_TEMPLATES": str(ROOT / "prod/etc/homelab-paas"),
            "TEST_SHA": SHA,
        }

    def executable(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o700)

    def script(self):
        return (ROOT / "prod/install.sh").read_text().replace(
            "config_dir=/etc/homelab-paas", "config_dir=" + str(self.etc)
        ).replace("state_dir=/var/homelab-paas", "state_dir=" + str(self.var))

    def run_installer(self, credentials=None, trace=False, settings=SETTINGS, token=TOKEN):
        # A controlling PTY plus a separate stdin pipe reproduces curl | bash.
        script = self.script().encode()
        pid, terminal = pty.fork()
        if pid == 0:
            try:
                result = subprocess.run(
                    [str(self.bin / "bash"), *(["-x"] if trace else [])],
                    input=script, env=self.env,
                )
                os._exit(result.returncode)
            except BaseException:
                os._exit(99)
        output = b""
        sent = 0
        prompts = (
            b"Root domain", b"Admin's GitHub username:", b"ACME email:",
            b"GitHub client ID:", b"GitHub client secret:", b"DigitalOcean API token:",
        )
        answers = (*settings, *credentials, token) if credentials else ()
        deadline = time.monotonic() + 10
        try:
            while time.monotonic() < deadline:
                if select.select([terminal], [], [], 0.1)[0]:
                    try:
                        data = os.read(terminal, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if not data:
                        break
                    output += data
                    if answers and sent < len(prompts):
                        prompt = prompts[sent]
                        if prompt in output:
                            os.write(terminal, answers[sent].encode() + b"\n")
                            sent += 1
            else:
                os.kill(pid, 9)
                self.fail("Installer timed out")
        finally:
            os.close(terminal)
            _, status = os.waitpid(pid, 0)
        return os.waitstatus_to_exitcode(status), output.decode()

    def test_installs_private_config_with_hidden_escaped_credentials_and_sha(self):
        credentials = ('client: "quoted" \\ value', "secret' # $literal")
        status, output = self.run_installer(credentials, trace=True)
        self.assertEqual(status, 0, output)
        for credential in (*credentials, TOKEN):
            self.assertNotIn(credential, output)
        config = (self.etc / "config.yaml").read_text()
        fields = dict(line.strip().split(": ", 1) for line in config.splitlines() if ": " in line)
        self.assertEqual(json.loads(fields["clientId"]), credentials[0])
        self.assertEqual(json.loads(fields["clientSecret"]), credentials[1])
        self.assertEqual(json.loads(fields["baseDomain"]), SETTINGS[0])
        self.assertIn("            - " + json.dumps(SETTINGS[1]), config)
        self.assertEqual(json.loads(fields["email"]), SETTINGS[2])
        self.assertEqual(json.loads(fields["apiToken"]), TOKEN)
        for placeholder in ("apps.example.com", "admin@example.com", "replace-with-"):
            self.assertNotIn(placeholder, config.split("# Add services")[0])
        signing_key = json.loads(fields["signingKey"])
        self.assertRegex(signing_key, r"^[0-9a-f]{64}$")
        self.assertNotIn(signing_key, output)
        self.assertIn("ghcr.io/maxine4j/homelab-paas:" + SHA, (self.etc / "docker-compose.yaml").read_text())
        for path in (self.etc, self.etc / "env", self.var):
            self.assertEqual(path.stat().st_mode & 0o777, 0o700)
        for name in ("config.yaml", "envoy.yaml", "docker-compose.yaml"):
            self.assertEqual((self.etc / name).stat().st_mode & 0o777, 0o600)
        self.assertIn("services", output)
        self.assertIn("https://auth." + SETTINGS[0] + "/auth/callback", output)
        self.assertNotIn("Set your domain", output)

    def test_installs_without_python_on_path(self):
        status, output = self.run_installer(("client", "secret"))
        self.assertEqual(status, 0, output)

    def test_credentials_containing_template_tokens_are_preserved(self):
        credentials = ("replace-with-digitalocean-api-token", "replace-with-a-random-secret-of-at-least-32-characters")
        token = "replace-with-github-client-id admin@example.com apps.example.com"
        status, output = self.run_installer(credentials, token=token)
        self.assertEqual(status, 0, output)
        config = (self.etc / "config.yaml").read_text()
        fields = dict(line.strip().split(": ", 1) for line in config.splitlines() if ": " in line)
        self.assertEqual(json.loads(fields["clientId"]), credentials[0])
        self.assertEqual(json.loads(fields["clientSecret"]), credentials[1])
        self.assertEqual(json.loads(fields["apiToken"]), token)

    def test_existing_installation_is_preserved(self):
        self.etc.mkdir()
        existing = self.etc / "config.yaml"
        existing.write_text("keep-existing-secret")
        status, output = self.run_installer()
        self.assertNotEqual(status, 0, output)
        self.assertEqual(existing.read_text(), "keep-existing-secret")
        self.assertFalse(self.var.exists())

    def test_missing_terminal_fails_without_creating_host_files(self):
        # setsid removes any inherited controlling terminal on Linux/macOS.
        result = subprocess.run(
            [str(self.bin / "bash")], input=self.script(), text=True,
            env=self.env, capture_output=True, start_new_session=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("terminal", result.stderr.lower())
        self.assertFalse(self.etc.exists())

    def test_nonroot_fails_before_writing(self):
        self.executable("id", "#!/bin/sh\nprintf '1000\\n'\n")
        status, output = self.run_installer()
        self.assertNotEqual(status, 0, output)
        self.assertIn("sudo", output)
        self.assertFalse(self.etc.exists())

    def test_empty_credentials_fail_without_writing(self):
        status, output = self.run_installer(("", "secret"))
        self.assertNotEqual(status, 0, output)
        self.assertFalse(self.etc.exists())

    def test_empty_settings_and_token_fail_without_writing(self):
        for index, message in enumerate(("Root domain", "Admin's GitHub username", "ACME email", "DigitalOcean API token")):
            with self.subTest(field=message):
                settings = list(SETTINGS)
                token = TOKEN
                if index < 3:
                    settings[index] = ""
                else:
                    token = ""
                status, output = self.run_installer(("client", "secret"), settings=settings, token=token)
                self.assertNotEqual(status, 0, output)
                self.assertIn(message + " must not be empty.", output)
                self.assertFalse(self.etc.exists())


if __name__ == "__main__":
    unittest.main()
