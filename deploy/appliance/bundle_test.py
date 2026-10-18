"""Verify the packaged SPA at the path the backend serves."""

from html.parser import HTMLParser
from pathlib import PurePosixPath
import sys
import tarfile
import unittest

LAYER = sys.argv.pop()
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
        with tarfile.open(LAYER) as archive:
            files = {str(PurePosixPath(member.name)): member for member in archive.getmembers()}
            index = files.get(f"{PREFIX}/index.html")
            self.assertIsNotNone(index, "index.html must be at the UI root")
            content = archive.extractfile(index)
            self.assertIsNotNone(content)
            parser = AssetReferences()
            parser.feed(content.read().decode())
            self.assertTrue(parser.paths, "index.html must reference built assets")
            for path in parser.paths:
                self.assertIn(f"{PREFIX}{path}", files, f"Missing packaged asset: {path}")


if __name__ == "__main__":
    unittest.main()
