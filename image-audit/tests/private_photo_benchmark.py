#!/usr/bin/env python3
"""PRIVATE real-photo regression evaluator (NO network or uploads).
Photos and name mappings are read from a local zip supplied by the operator.
This script is safe for a PUBLIC source repository: it contains NO real photos.
Optional OpenCV SIFT is an INDEPENDENT diagnostic reference, not the JS engine.
"""
import argparse
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SCORE = re.compile(r"(?:跨版本共用視覺相似度|共同視覺初篩分數)\s*[：:]\s*([0-9]+(?:\.[0-9]+)?)\s*%")

def _safe_names(names):
    for name in names:
        p = PurePosixPath(name)
        if p.is_absolute() or ".." in p.parts or "\\" in name:
            raise ValueError("Unsafe ZIP member path")
        if len(name) > 500:
            raise ValueError("Unusually long ZIP path")

def _pair(a, b):
    return frozenset((a.strip(), b.strip()))

def _filename(s):
    # DOCX table cells contain "第二批次｜name.png", sometimes split across runs.
    s = re.sub(r"\s+", "", s)
    return PurePosixPath(s.rsplit("｜", 1)[-1]).name

def load_dataset(path):
    with zipfile.ZipFile(path) as z:
        _safe_names(z.namelist())
        if "manifest.json" not in z.namelist():
            raise ValueError("Expected private archive with manifest.json; do not upload raw photos to public GitHub")
        m = json.loads(z.read("manifest.json"))
        assets = {n for n in z.namelist() if n.startswith("photos/") and n.lower().endswith((".jpg", ".jpeg", ".png"))}
        if len(assets) != m["photo_count"]:
            raise ValueError("Dataset count differs from manifest")
        if len(assets) > 2000 or sum(z.getinfo(n).file_size for n in assets) > 400_000_000:
            raise ValueError("Dataset exceeds benchmark limits")
        for n, digest in m.get("sha256", {}).items():
            if n not in assets or hashlib.sha256(z.read(n)).hexdigest() != digest:
                raise ValueError("Photo integrity mismatch")
        expected = {_pair(_filename(a), _filename(b)) for a, b in m["positive_pairs"]}
        if len(expected) != len(m["positive_pairs"]):
            raise ValueError("Duplicated expected positive pairs")
        return m, expected

def parse_report(path):
    with zipfile.ZipFile(path) as z:
        data = z.read("word/document.xml")
    root = ET.fromstring(data)
    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("Invalid DOCX structure")
    matches = {}
    last_score = None
    for node in body:
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "p":
            content = "".join(x.text or "" for x in node.findall(".//w:t", NS))
            hit = SCORE.search(content)
            if hit:
                last_score = float(hit.group(1))
        elif tag == "tbl":
            tr = node.find("w:tr", NS)
            if tr is None:
                continue
            cells = tr.findall("w:tc", NS)
            if len(cells) < 2:
                continue
            names = [_filename("".join(x.text or "" for x in c.findall(".//w:t", NS))) for c in cells[:2]]
            matches[_pair(*names)] = last_score
            last_score = None
    return matches

def report_eval(name, found, positives):
    tp = positives.intersection(found)
    missing = positives.difference(found)
    print("%s: found=%d, confirmed-positive=%d/%d, missing=%d" %
          (name, len(found), len(tp), len(positives), len(missing)))
    for group in sorted(missing, key=lambda x: sorted(x)):
        print("  missed:", " <> ".join(sorted(group)))
    return len(tp)

def reference_sift(dataset, threshold=45):
    """Independent OpenCV baseline. It does not test the browser/desktop JS pipeline."""
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise SystemExit("Optional --reference-sift requires local pip install opencv-python numpy") from exc
    with zipfile.ZipFile(dataset) as z:
        files = [n for n in z.namelist() if n.startswith("photos/") and n.lower().endswith(".png")]
        detector = cv2.SIFT_create(nfeatures=1100)
        feats = {}
        for n in files:
            im = cv2.imdecode(np.frombuffer(z.read(n), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
            if im is None:
                raise ValueError("Unreadable image in dataset")
            feats[n] = detector.detectAndCompute(im, None)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    best = []
    for i, a in enumerate(files):
        for b in files[i+1:]:
            if PurePosixPath(a).parts[1] == PurePosixPath(b).parts[1]:
                continue
            kp1, d1 = feats[a]; kp2, d2 = feats[b]
            if d1 is None or d2 is None:
                continue
            good = [m for m, n in matcher.knnMatch(d1, d2, k=2) if m.distance < .72*n.distance]
            if len(good) < 4:
                continue
            p1 = np.float32([kp1[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            p2 = np.float32([kp2[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            _, mask = cv2.estimateAffinePartial2D(p1, p2, method=cv2.RANSAC, ransacReprojThreshold=4)
            count = int(mask.sum()) if mask is not None else 0
            if count >= threshold:
                best.append((_pair(_filename(a), _filename(b)), count))
    return best

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dataset", required=True, help="local private benchmark zip (never commit to public repo)")
    p.add_argument("--web-report", help="web edition DOCX")
    p.add_argument("--desktop-report", help="desktop edition DOCX")
    p.add_argument("--reference-sift", action="store_true", help="independent OpenCV SIFT geometry diagnostic")
    p.add_argument("--min-web-recall", type=int, default=0, help="optional minimum correct-positive count")
    p.add_argument("--min-desktop-recall", type=int, default=0, help="optional minimum correct-positive count")
    args = p.parse_args()
    manifest, positives = load_dataset(args.dataset)
    print("Private dataset:", manifest["photo_count"], "images,", manifest["pair_count"], "cross-folder pairs,", len(positives), "independently checked positive pairs")
    web = parse_report(args.web_report) if args.web_report else None
    desktop = parse_report(args.desktop_report) if args.desktop_report else None
    codes = []
    if web is not None:
        n = report_eval("WEB", web, positives)
        codes.append(n >= args.min_web_recall)
    if desktop is not None:
        n = report_eval("DESKTOP", desktop, positives)
        codes.append(n >= args.min_desktop_recall)
    if web is not None and desktop is not None:
        common = web.keys() & desktop.keys()
        differences = {g: (web[g], desktop[g]) for g in common if web[g] is not None and desktop[g] is not None and abs(web[g]-desktop[g]) > .1}
        print("Shared common-score parity: %d pairs, score mismatches=%d" % (len(common), len(differences)))
        codes.append(not differences)
    if args.reference_sift:
        found = reference_sift(args.dataset)
        positives_found = {p for p, _ in found}
        print("Independent OpenCV reference: %d candidates; %d/%d confirmed positives" %
              (len(found), len(positives_found & positives), len(positives)))
        codes.append(positives <= positives_found)
    if not args.reference_sift and web is None and desktop is None:
        print("Integrity: PASS. Supply DOCX reports or --reference-sift for recognition evaluation.")
    if codes and not all(codes):
        raise SystemExit(1)
    return 0

if __name__ == "__main__":
    sys.exit(main())
