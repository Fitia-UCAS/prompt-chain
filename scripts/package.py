from pathlib import Path
import hashlib,json,zipfile

root=Path(__file__).resolve().parents[1]
out=root.parent/'.cache'/'prompt-flow'
out.mkdir(parents=True,exist_ok=True)
version=json.loads((root/'manifest.json').read_text(encoding='utf-8'))['version']
target=out/f'Prompt-Chain-{version}.zip'
files=[p for p in root.iterdir() if p.is_file() and (p.suffix in {'.js','.html','.css'} or p.name in {'manifest.json','README.md','ARCHITECTURE.md','REVIEW.md','COMPARISON.md','UPSTREAM.md','TASKS.md','REQUIREMENTS-AUDIT.md','TESTING-OPTIONS.md'})]
for name in ['assets','images','icons','content','shared','vendor','background']:files.extend(p for p in (root/name).rglob('*') if p.is_file())
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
 for file in sorted(files):archive.write(file,file.relative_to(root).as_posix())
print(json.dumps({'path':str(target),'files':len(files),'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},ensure_ascii=False,indent=2))
