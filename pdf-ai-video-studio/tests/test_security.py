"""Unit tests for local server security configuration (stdlib only)."""
import importlib.util
from pathlib import Path
import unittest
import sys

source=Path(__file__).resolve().parents[1]/"local-service"/"server.py"
sys.path.insert(0,str(source.parent))
spec=importlib.util.spec_from_file_location("pdf_ai_studio_service",source)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SecurityTests(unittest.TestCase):
    def test_https_provider(self):
        self.assertTrue(module.valid_url("https://api.example.org/v1"))
        self.assertFalse(module.valid_url("http://api.example.org/v1"))
        self.assertFalse(module.valid_url("https://me:pwd@api.example.org/v1"))
    def test_ollama_local_http(self):
        self.assertTrue(module.valid_url("http://127.0.0.1:11434/v1"))
        self.assertFalse(module.valid_url("http://192.168.1.10:11434/v1"))
    def test_exact_origin(self):
        self.assertIn("https://ymguan3-boop.github.io",module.ORIGINS)
        self.assertNotIn("https://untrusted.example",module.ORIGINS)
    def test_tts_allowlist(self):
        self.assertIn("zh-TW-YunJheNeural",module.VOICES)
        self.assertNotIn("../../etc/passwd",module.VOICES)

if __name__=="__main__":
    unittest.main()
