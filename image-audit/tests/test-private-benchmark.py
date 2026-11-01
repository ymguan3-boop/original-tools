"""Synthetic smoke test of the PRIVATE test harness. No engineering photos used."""
import hashlib
import importlib.util
import json
import tempfile
import zipfile
from pathlib import Path

source = Path(__file__).with_name("private_photo_benchmark.py")
spec = importlib.util.spec_from_file_location("private_photo_benchmark", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as folder:
    folder = Path(folder)
    dataset = folder / "fixture.zip"
    a, b = "photos/A/test-one.png", "photos/B/test-two.png"
    bytes_a, bytes_b = b"fake-image-A", b"fake-image-B"
    manifest = {
        "photo_count": 2,
        "pair_count": 1,
        "positive_pairs": [[a, b]],
        "sha256": {a: hashlib.sha256(bytes_a).hexdigest(), b: hashlib.sha256(bytes_b).hexdigest()},
    }
    with zipfile.ZipFile(dataset, "w") as z:
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr(a, bytes_a)
        z.writestr(b, bytes_b)
    checked, positives = module.load_dataset(dataset)
    assert checked["photo_count"] == 2
    assert positives == {frozenset(("test-one.png", "test-two.png"))}

    report = folder / "test.docx"
    xml = (
        '<?xml version="1.0"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body><w:p><w:r><w:t>跨版本共用視覺相似度：92.1%</w:t></w:r></w:p>'
        '<w:tbl><w:tr>'
        '<w:tc><w:p><w:r><w:t>A｜test-one.png</w:t></w:r></w:p></w:tc>'
        '<w:tc><w:p><w:r><w:t>B｜test-two.png</w:t></w:r></w:p></w:tc>'
        '</w:tr></w:tbl></w:body></w:document>'
    )
    with zipfile.ZipFile(report, "w") as z:
        z.writestr("word/document.xml", xml)
    matched = module.parse_report(report)
    assert len(matched) == 1 and next(iter(matched.values())) == 92.1
    assert len(positives.intersection(matched)) == 1
    print("PASS: private dataset integrity, positive labels, DOCX pair parser using synthetic files only")
