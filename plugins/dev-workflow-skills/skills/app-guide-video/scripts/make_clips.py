"""Convert the newest Playwright .webm recording of each chapter into a small MP4.
usage: DEMO_DIR=<dir> python3 make_clips.py <chapter-dir> <output-name> [<chapter-dir> <output-name> ...]
Recordings live in $DEMO_DIR/rec/<chapter>/*.webm. Output goes to $DEMO_DIR/out/<output-name>.mp4."""
import glob, os, subprocess, sys
D = os.environ['DEMO_DIR']
args = sys.argv[1:]
for ch, name in zip(args[::2], args[1::2]):
    files = sorted(glob.glob(f'{D}/rec/{ch}/*.webm'), key=os.path.getmtime)
    if not files:
        print('missing recording for', ch); continue
    dst = f'{D}/out/{name}.mp4'
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', files[-1], '-c:v', 'libx264', '-preset', 'slow',
                    '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', dst], check=True)
    print(name, round(os.path.getsize(dst) / 1e6, 2), 'MB')
