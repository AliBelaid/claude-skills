"""Run a whole flow: chapters in order, IDs captured from one chapter for the next, optional hooks,
then clips and one narrated video.

usage: python3 run_flow.py <flow-dir>      (flow-dir contains flow.json and the chapter files)

flow.json keys:
  config     path to config.json (relative to flow-dir)
  month      YYYY-MM used for ${MONTH}
  chapters   chapter files in run order
  after      {"<chapter file>": "shell command"} run right after that chapter
  clips      [[chapter-name, clip-name], ...] for make_clips
  narration  one Arabic (or other) line per clip, same order as clips

Environment it reads: APP_USER, APP_PASSWORD (login), REVIEWER_CODE, REVIEWER_PASSWORD (hooks),
DEMO_USER_PASSWORD (password for the user created in the flow). Nothing is written to disk except the
recordings and the captured IDs in the output folder.
"""
import json, os, subprocess, sys, time
from pathlib import Path

flow_dir = Path(sys.argv[1]).resolve()
flow = json.loads((flow_dir / 'flow.json').read_text(encoding='utf-8'))
cfg_path = (flow_dir / flow['config']).resolve()
cfg = json.loads(cfg_path.read_text(encoding='utf-8'))
out_dir = Path(os.path.expanduser(cfg.get('outputDir', './guide-output'))).resolve()
skill_scripts = Path(__file__).resolve().parent
out_dir.mkdir(parents=True, exist_ok=True)
captured_file = out_dir / 'captured.json'
if captured_file.exists():
    captured_file.unlink()           # fresh IDs for every run

for var in ('APP_USER', 'APP_PASSWORD'):
    if not os.environ.get(var):
        sys.exit(f'set {var} in the environment before running')

stamp = str(int(time.time()))
run = stamp[-4:]
env = dict(os.environ)
env.update({
    'RUN': run,
    'NID': '2' + str(int(time.time() * 1000))[-11:],   # 12 digits starting with 2, as the national ID rule requires
    'PATIENT_AR': f'مريض تجريبي {run}',
    'PATIENT_EN': f'Demo Patient {run}',
    'USER_CODE': f'demo.staff{run}',
    'USER_PASSWORD': os.environ.get('DEMO_USER_PASSWORD', ''),
    'MONTH': flow['month'],
    'ADMIN_CODE': os.environ['APP_USER'],
    'API': cfg['apiUrl'],
    'REVIEWER_CODE': os.environ.get('REVIEWER_CODE', ''),
    'REVIEWER_PASSWORD': os.environ.get('REVIEWER_PASSWORD', ''),
    'DEMO_DIR': str(out_dir),
})
if not env['USER_PASSWORD']:
    sys.exit('set DEMO_USER_PASSWORD (test password for the user the flow creates)')

def load_captured():
    return json.loads(captured_file.read_text(encoding='utf-8')) if captured_file.exists() else {}

for chapter in flow['chapters']:
    env.update(load_captured())
    print(f'== {chapter}', flush=True)
    rc = subprocess.run(['node', str(skill_scripts / 'record.mjs'), str(cfg_path), str(flow_dir / chapter)], env=env).returncode
    if rc != 0:
        sys.exit(f'stopped at {chapter}: see the FAILED screenshot in {out_dir / "shots"}')
    if chapter in flow.get('after', {}):
        print(f'   hook: {flow["after"][chapter]}', flush=True)
        if subprocess.run(flow['after'][chapter], shell=True, cwd=flow_dir, env=env).returncode != 0:
            sys.exit(f'hook failed after {chapter}')

env.update(load_captured())
clips = flow['clips']
subprocess.run([sys.executable, str(skill_scripts / 'make_clips.py')] + [x for pair in clips for x in pair],
               env=env, check=True)
plan = {
    'speed': cfg.get('speed', 1.25), 'voice': cfg.get('voice', 'Majed'),
    'out': f'full-guide-{run}.mp4',
    'clips': [{'file': f'{clip}.mp4', 'say': line} for (_, clip), line in zip(clips, flow['narration'])],
}
plan_path = out_dir / f'plan-{run}.json'
plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding='utf-8')
subprocess.run([sys.executable, str(skill_scripts / 'combine.py'), str(plan_path)], env=env, check=True)
print('done: run', run, '->', out_dir / 'full' / plan['out'])
