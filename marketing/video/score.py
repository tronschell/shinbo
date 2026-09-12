import array
import math
import random
import wave
from pathlib import Path

rate = 48000
length = 60
rng = random.Random(9)
samples = array.array('h')
notes = [130.8128, 164.8138, 195.9977, 246.9417, 261.6256, 195.9977, 164.8138, 146.8324]
for i in range(rate * length):
    t = i / rate
    beat = t % .5
    pulse = t % .25
    note = notes[int(t / .5) % len(notes)]
    lead = math.sin(2 * math.pi * note * t) * math.exp(-pulse * 14) * .085
    lead += math.sin(2 * math.pi * note * 2 * t) * math.exp(-pulse * 23) * .024
    kick = math.sin(2 * math.pi * (48 * beat + 3 * (1 - math.exp(-beat * 30)))) * math.exp(-beat * 24) * .22
    hat = (rng.random() * 2 - 1) * math.exp(-pulse * 140) * .035
    bass = math.sin(2 * math.pi * 65.4064 * t) * .045
    swell = math.sin(math.pi * min(1, t / 2)) if t < 1 else 1
    fade = min(1, t / .4, max(0, (length - t) / 2))
    signal = (lead + kick + hat + bass) * fade
    samples.append(int(max(-1, min(1, signal)) * 32767))
with wave.open(str(Path(__file__).parent / 'public/score.wav'), 'wb') as out:
    out.setnchannels(1)
    out.setsampwidth(2)
    out.setframerate(rate)
    out.writeframes(samples.tobytes())
assert len(samples) == rate * length
