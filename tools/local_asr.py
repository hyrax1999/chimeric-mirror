"""Bounded PCM16 to local MLX Whisper worker. JSON lines, no network credentials."""
import base64
import json
import sys
from pathlib import Path

sys.path.insert(0, sys.argv[1])
import numpy as np
from LocalService.asr import WhisperASR
model = sys.argv[2]
engines = {}
print(json.dumps({'type':'ready'}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        pcm = base64.b64decode(request['pcm'], validate=True)
        if not pcm or len(pcm) % 2 or len(pcm) > 960000:
            raise ValueError('expected 1–30 seconds of mono 16 kHz PCM16 audio')
        samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
        language = (request.get('language') or 'auto').split('-')[0]
        if language not in engines:
            engines[language] = WhisperASR(model_id=model, language=language)
        text = '' if float(np.max(np.abs(samples))) < .001 else engines[language].transcribe(samples).text
        print(json.dumps({'id':request['id'],'text':text}), flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id'),'error':str(error)}), flush=True)
