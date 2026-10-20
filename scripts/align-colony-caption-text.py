"""Preserve the authored opening text while aligning it to transcribed passages."""
import difflib
import json
import re
from pathlib import Path
root = Path('public/assets/game-narration')
manifest = json.loads((root / 'manifest.json').read_text())
timings = json.loads((root / 'colony-timings.json').read_text())
for key, segments in timings.items():
    original = manifest['clips'][key]['text'].split()
    heard, starts = [], []
    for segment in segments:
        starts.append(len(heard))
        heard.extend(segment['text'].split())
    def norm(word):
        return re.sub('[^a-z0-9]', '', word.lower())
    mapping = {}
    for block in difflib.SequenceMatcher(None, list(map(norm, heard)), list(map(norm, original)), autojunk=False).get_matching_blocks():
        for offset in range(block.size):
            mapping[block.a + offset] = block.b + offset
    boundaries = [0]
    for start in starts[1:]:
        nearest = next((n for n in range(start, min(start + 10, len(heard))) if n in mapping), None)
        index = mapping[nearest] if nearest is not None else round(start * len(original) / len(heard))
        boundaries.append(max(boundaries[-1], index))
    boundaries.append(len(original))
    for index, segment in enumerate(segments):
        segment['text'] = ' '.join(original[boundaries[index]:boundaries[index+1]])
(root / 'colony-timings.json').write_text(json.dumps(timings, indent=2))
Path('public/colony-voice-data.js').write_text('window.ColonyVoiceTimings=' + json.dumps(timings) + ';\n')
