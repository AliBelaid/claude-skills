"""Build one narrated guide video from the chapter MP4s.
usage: DEMO_DIR=<dir> python3 combine.py plan.json
plan.json: {"speed": 1.25, "voice": "Majed", "out": "full-guide.mp4",
            "clips": [{"file": "01-navigation-tour.mp4", "say": "Arabic narration text"}, ...]}
Narration is rendered with macOS `say` (any installed voice; `say -v ?` lists them). Each line starts 0.3 s into its clip.
The script prints an OVERRUN warning when a line is longer than its clip; shorten that line."""
import json, os, subprocess, sys
D = os.environ['DEMO_DIR']
plan = json.load(open(sys.argv[1], encoding='utf-8'))
SPEED = plan.get('speed', 1.25)
clips = plan['clips']
AUD = f'{D}/full/audio'; os.makedirs(AUD, exist_ok=True)

def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
                                capture_output=True, text=True).stdout.strip())

t = 0.0; starts = []
for i, c in enumerate(clips):
    wav = f'{AUD}/{i:02d}.wav'
    subprocess.run(['say', '-v', plan.get('voice', 'Majed'), '-o', f'{AUD}/{i:02d}.aiff', c['say']], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{AUD}/{i:02d}.aiff', '-ar', '44100', '-ac', '1', wav], check=True)
    vd = dur(f"{D}/out/{c['file']}") / SPEED
    ad = dur(wav)
    if 0.3 + ad > vd:
        print(f"OVERRUN {c['file']}: narration {ad:.1f}s > clip {vd:.1f}s — shorten the text")
    starts.append((t, vd, ad)); t += vd

inputs, vf, af = [], [], []
for i, c in enumerate(clips):
    inputs += ['-i', f"{D}/out/{c['file']}", '-i', f'{AUD}/{i:02d}.wav']
    vf.append(f'[{2*i}:v]setpts=PTS/{SPEED},fps=25,scale=1280:720,setsar=1[v{i}]')
    delay = int((starts[i][0] + 0.3) * 1000)
    af.append(f'[{2*i+1}:a]adelay={delay}|{delay},volume=1.6[a{i}]')
n = len(clips)
vf.append(''.join(f'[v{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0[vout]')
fc = ';'.join(vf + af + [''.join(f'[a{i}]' for i in range(n)) + f'amix=inputs={n}:normalize=0,alimiter=limit=0.95[aout]'])
out = f"{D}/full/{plan.get('out', 'full-guide.mp4')}"
os.makedirs(os.path.dirname(out), exist_ok=True)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error'] + inputs + ['-filter_complex', fc, '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', out], check=True)
print('wrote', out, round(os.path.getsize(out) / 1e6, 2), 'MB,', round(t, 1), 's')
