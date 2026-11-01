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
        self.assertIn("http://127.0.0.1:8765",module.ORIGINS)
        self.assertNotIn("https://ymguan3-boop.github.io",module.ORIGINS)
        self.assertNotIn("https://untrusted.example",module.ORIGINS)
    def test_tts_allowlist(self):
        self.assertIn("zh-TW-YunJheNeural",module.VOICES)
        self.assertNotIn("../../etc/passwd",module.VOICES)

    def test_workflow_placeholders(self):
        import tempfile, json
        import engine_service
        old=engine_service.WORKFLOWS
        with tempfile.TemporaryDirectory() as temp:
            engine_service.WORKFLOWS=Path(temp)
            try:
                graph={"7":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__"}}}
                (Path(temp)/"wan22.json").write_text(json.dumps(graph),encoding="utf-8")
                out=engine_service.graph_for("wan22","畫面示意")
                self.assertEqual(out["7"]["inputs"]["text"],"畫面示意")
                with self.assertRaises(ValueError):
                    engine_service.graph_for("../../evil","prompt")
            finally:
                engine_service.WORKFLOWS=old
    def test_static_file_allowlist(self):
        self.assertNotIn("/pdf-ai-video-studio/local-service/.env",module.STATIC)
        self.assertIn("/pdf-ai-video-studio/index.html",module.STATIC)
        self.assertIn("/pdf-voice-video/lib/pdf.min.js",module.STATIC)

    def test_desktop_python_and_comfyui_metadata(self):
        import engine_service
        self.assertTrue(module.STATIC["/pdf-ai-video-studio/index.html"][0].name=="index.html")
        self.assertEqual(engine_service.BASE,"http://127.0.0.1:8188")
        self.assertTrue(engine_service.status()["python"]["installed"])
        self.assertEqual(engine_service.status()["comfyui_download_url"],"https://www.comfy.org/download")
    def test_optional_dependency_probe(self):
        import engine_service
        data=engine_service.preflight_tools()
        for key in ("ffmpeg_in_path","git_in_path","ollama_api_ready","free_disk_gb","links"):
            self.assertIn(key,data)
        self.assertIsInstance(data["ffmpeg_in_path"],bool)
        self.assertIn("ffmpeg.org/download",data["links"]["ffmpeg"])
        probe=engine_service.status()
        self.assertIn("dependencies",probe)
        self.assertIn("hardware",probe)

    def test_first_run_llm_config_never_exposes_key(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            original_root=module.ROOT
            module.ROOT=Path(directory)
            try:
                saved=module.save_llm_config({
                    "base_url":"https://example.test/v1",
                    "model":"test-model",
                    "api_key":"very-private-demo-key",
                    "keep_existing_key":False,
                })
                self.assertTrue(saved["has_api_key"])
                self.assertNotIn("api_key",saved)
                self.assertNotIn("very-private-demo-key",repr(saved))
                self.assertIn("very-private-demo-key",(Path(directory)/".env").read_text())
                with self.assertRaises(ValueError):
                    module.save_llm_config({
                        "base_url":"http://127.0.0.1:11434/v1",
                        "model":"test-model",
                        "api_key":"must-not-send-over-http",
                        "keep_existing_key":False,
                    })
                with self.assertRaises(ValueError):
                    module.save_llm_config({
                        "base_url":"https://example.test/v1\nINJECT=1",
                        "model":"test",
                        "api_key":"",
                        "keep_existing_key":False,
                    })
            finally:
                module.ROOT=original_root

    def test_hardware_scan_reading_and_stale_fallback(self):
        import tempfile, json, time
        import engine_service
        original=engine_service.WORKFLOWS
        with tempfile.TemporaryDirectory() as directory:
            engine_service.WORKFLOWS=Path(directory)/"workflows"
            (Path(directory)/"workflows").mkdir()
            try:
                path=Path(directory)/".hardware-report.json"
                data={
                    "version":1,"checked_at":"2026-11-01T09:00:00Z",
                    "cpu_name":"Example CPU","physical_cores":8,"logical_cores":16,
                    "ram_gb":31.8,"gpu_names":["Example NVIDIA GPU"],
                    "nvidia_vram_gb":23.6,"free_disk_gb":48.1,
                    "basic_ready":True,"basic_recommended":True,
                    "advanced_tier":"medium","notes":[]
                }
                path.write_text(json.dumps(data),encoding="utf-8")
                got=engine_service.hardware_preflight()
                self.assertEqual(got["logical_cores"],16)
                self.assertEqual(got["ram_gb"],31.8)
                self.assertTrue(got["basic_ready"])
                self.assertEqual(got["gpu_names"],["Example NVIDIA GPU"])
                path.write_text(json.dumps({"version":1,"logical_cores":2,"basic_ready":False}),encoding="utf-8")
                self.assertFalse(engine_service.hardware_preflight()["basic_ready"])
                old=time.time()-90000
                import os
                os.utime(path,(old,old))
                self.assertIsNone(engine_service.hardware_preflight()["basic_ready"])
            finally:
                engine_service.WORKFLOWS=original

    def test_block_nonlocal_host(self):
        class Fake:
            headers={"Host":"evil.test:8765","Origin":None}
        self.assertFalse(module.Handler.allowed(Fake()))
        class Local:
            headers={"Host":"127.0.0.1:8765","Origin":"http://127.0.0.1:8765"}
        self.assertTrue(module.Handler.allowed(Local()))

if __name__=="__main__":
    unittest.main()
