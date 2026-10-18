"""Verify the packaged SPA at the path the backend serves."""

from html.parser import HTMLParser
import io
import json
from pathlib import PurePosixPath
import sys
import tarfile
import unittest

IMAGE = sys.argv.pop()
PREFIX = "usr/share/homelab-paas/ui"


class AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("src", "href") and value and value.startswith("/assets/"):
                self.paths.append(value)


class BundleTest(unittest.TestCase):
    def test_index_and_referenced_assets_exist(self):
        with tarfile.open(IMAGE) as archive:
            def read(name):
                file = archive.extractfile(name)
                self.assertIsNotNone(file)
                return file.read()

            def blob(descriptor):
                algorithm, digest = descriptor["digest"].split(":", 1)
                self.assertEqual(algorithm, "sha256")
                return f"blobs/{algorithm}/{digest}"

            index = json.loads(read("index.json"))
            descriptor = next(item for item in index["manifests"]
                              if item.get("platform", {}).get("os") != "unknown")
            manifest = json.loads(read(blob(descriptor)))
            if "manifests" in manifest:
                descriptor = next(item for item in manifest["manifests"]
                                  if item.get("platform", {}).get("os") == "linux")
                manifest = json.loads(read(blob(descriptor)))
            files = {}
            for layer in manifest["layers"]:
                with tarfile.open(fileobj=io.BytesIO(read(blob(layer)))) as content:
                    for member in content.getmembers():
                        path = PurePosixPath(member.name)
                        if path.name.startswith(".wh."):
                            removed = str(path.parent / path.name.removeprefix(".wh."))
                            for name in list(files):
                                if name == removed or name.startswith(removed + "/"):
                                    del files[name]
                        elif member.isfile():
                            files[str(path)] = content.extractfile(member).read() if str(path).startswith(PREFIX) else b""
            self.assertIn("opt/homelab-paas/dist/main.js", files)
            self.assertIn(f"{PREFIX}/index.html", files, "index.html must be at the UI root")
            parser = AssetReferences()
            parser.feed(files[f"{PREFIX}/index.html"].decode())
            self.assertTrue(parser.paths, "index.html must reference built assets")
            for path in parser.paths:
                self.assertIn(f"{PREFIX}{path}", files, f"Missing packaged asset: {path}")


if __name__ == "__main__":
    unittest.main()
