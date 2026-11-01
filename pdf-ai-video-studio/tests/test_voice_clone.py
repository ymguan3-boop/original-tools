"""Index-TTS2 local voice-clone tests (stdlib only; never contacts ComfyUI)."""
import importlib.util
from pathlib import Path
import sys
import unittest
import wave
from io import BytesIO

ROOT=Path(__file__).resolve().parents[1]/"local-service"
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location("voice_clone",ROOT/"voice_clone.py")
voice=importlib.util.module_from_spec(spec)
sys.modules["voice_clone"]=voice
spec.loader.exec_module(voice)

class VoiceCloneTests(unittest.TestCase):
    def test_workflow_is_fixed_and_audited(self):
        graph=voice.workflow()
        self.assertEqual({v["class_type"] for v in graph.values()},voice.REQUIRED_NODES)
        synth=next(n for n in graph.values() if n["class_type"]=="IndexTTS2BaseNode")
        self.assertEqual(synth["inputs"]["reference_audio"],["12",0])
    def test_audio_magic_validation(self):
        with BytesIO() as buf:
            with wave.open(buf,"wb") as w:
                w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
                w.writeframes(b"\0\0"*24000)
            kind,ext=voice.audio_type(buf.getvalue())
            self.assertEqual((kind,ext),("audio/wav","wav"))
        self.assertEqual(voice.audio_type(b"fLaC\0\0"),("audio/flac","flac"))
        self.assertEqual(voice.audio_type(b"ID3\0\0"),("audio/mpeg","mp3"))
        with self.assertRaises(ValueError):
            voice.audio_type(b"MZ executable")
    def test_explicit_consent_required(self):
        with self.assertRaisesRegex(ValueError,"授權"):
            voice.upload_reference("anything",False)
        with self.assertRaisesRegex(ValueError,"同意"):
            voice.render("測試","token",False)
    def test_reference_size_and_input_guard(self):
        with self.assertRaises(ValueError):
            voice.upload_reference("x"*11_200_001,True)
        with self.assertRaises(ValueError):
            voice.render("x"*601,"token",True)
        with self.assertRaises(ValueError):
            voice.render("你好","not-a-real-token",True)
    def test_only_known_job_can_be_fetched(self):
        with self.assertRaisesRegex(ValueError,"找不到"):
            voice._job("unknown-task-id")
    def test_output_collection_audio_only(self):
        output={"outputs":{"8":{"audio":[{"filename":"voice_001.mp3","type":"output","subfolder":"audio"}]}}}
        self.assertEqual(voice.audio_descriptor(output)["filename"],"voice_001.mp3")
        video={"outputs":{"8":{"gifs":[{"filename":"other.mp4"}]}}}
        self.assertIsNone(voice.audio_descriptor(video))

if __name__=="__main__":
    unittest.main()
