import argparse
import asyncio
import logging
import os
import numpy as np
import sherpa_onnx
from wyoming.asr import Transcript, Transcribe
from wyoming.audio import AudioChunk, AudioStop
from wyoming.event import Event
from wyoming.info import AsrModel, AsrProgram, Describe, Info
from wyoming.server import AsyncEventHandler, AsyncServer

logging.basicConfig(level=logging.INFO)
_LOGGER = logging.getLogger("wyoming_qwen_onnx")


class QwenWyomingHandler(AsyncEventHandler):
    def __init__(
        self,
        wyoming_info: Info,
        recognizer: sherpa_onnx.OfflineRecognizer,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.wyoming_info = wyoming_info
        self.recognizer = recognizer
        self.audio_bytes = bytearray()
        self.sample_rate = 16000

    async def handle_event(self, event: Event) -> bool:
        if Describe.is_type(event.type):
            await self.write_event(self.wyoming_info.event())
            return True

        if Transcribe.is_type(event.type):
            self.audio_bytes.clear()
            return True

        if AudioChunk.is_type(event.type):
            chunk = AudioChunk.from_event(event)
            self.audio_bytes.extend(chunk.audio)
            self.sample_rate = chunk.rate
            return True

        if AudioStop.is_type(event.type):
            if not self.audio_bytes:
                await self.write_event(Transcript(text="").event())
                return False

            samples = (
                np.frombuffer(self.audio_bytes, dtype=np.int16).astype(np.float32)
                / 32768.0
            )

            stream = self.recognizer.create_stream()
            stream.accept_waveform(self.sample_rate, samples)
            self.recognizer.decode_stream(stream)

            text = stream.result.text.strip()
            _LOGGER.info("Transcribed text: %s", text)

            await self.write_event(Transcript(text=text).event())
            return False

        return True


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True, help="Path to model directory")
    parser.add_argument("--uri", default="tcp://0.0.0.0:10300", help="Wyoming URI")
    parser.add_argument("--num-threads", type=int, default=4, help="CPU threads")
    args = parser.parse_args()

    model_dir = args.model_dir
    _LOGGER.info("Loading Qwen3-ASR ONNX model from %s...", model_dir)

    conv_frontend = os.path.join(model_dir, "conv_frontend.onnx")
    encoder = os.path.join(model_dir, "encoder.int8.onnx")
    decoder = os.path.join(model_dir, "decoder.int8.onnx")
    tokenizer = os.path.join(model_dir, "tokenizer")

    recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
        conv_frontend=conv_frontend,
        encoder=encoder,
        decoder=decoder,
        tokenizer=tokenizer,
        num_threads=args.num_threads,
        hotwords="Charlie"
    )
    _LOGGER.info("Qwen3-ASR ONNX loaded successfully.")

    wyoming_info = Info(
        asr=[
            AsrProgram(
                name="wyoming-qwen-onnx",
                description="Sherpa-ONNX Qwen3-ASR 0.6B INT8",
                attribution={
                    "name": "Qwen / k2-fsa",
                    "url": "https://github.com/k2-fsa/sherpa-onnx",
                },
                installed=True,
                version="1.0.0",
                models=[
                    AsrModel(
                        name="Qwen3-ASR-0.6B-INT8",
                        description="Qwen3 ASR 0.6B INT8 ONNX Model",
                        attribution={
                            "name": "Qwen",
                            "url": "https://github.com/QwenLM/Qwen3-ASR",
                        },
                        installed=True,
                        version="1.0.0",
                        languages=["auto", "fr", "en", "zh"],
                    )
                ],
            )
        ]
    )

    server = AsyncServer.from_uri(args.uri)
    _LOGGER.info("Starting Wyoming Qwen-ONNX server listening on %s", args.uri)

    await server.run(
        lambda *handler_args: QwenWyomingHandler(
            wyoming_info, recognizer, *handler_args
        )
    )


if __name__ == "__main__":
    asyncio.run(main())