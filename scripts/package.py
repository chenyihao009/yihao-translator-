"""Build a root-manifest install ZIP and a clean GitHub source ZIP.
Standard library only. No key, browser profile, network or private workspace required.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT=Path(__file__).resolve().parents[1]
RUNTIME=['manifest.json','content.js','core.js','caption-source.js','numbers.js','store.js','capture.js','source.js','service-worker.js',
         'worker.js','review.js','recovery.js','offscreen.html','offscreen.js','settings.html','settings.js','sentence-prompt.txt','subtitle-rules.txt','review-prompt.txt','help.html','help.js']
DOCS=['docs/INSTALL.md','docs/API_KEY.md','docs/FAQ.md','docs/UPDATE.md','docs/PRIVACY.md',
      'docs/PUBLISH_GITHUB.md','docs/DEVELOPMENT.md','docs/字幕规范.md',
      'docs/assets/main-panel.png','docs/assets/subtitle-style.png','docs/assets/bilingual-preview.png',
      'docs/assets/install-folder.svg','docs/assets/subtitle-details-main.png','docs/assets/subtitle-details-source.png',
      'docs/assets/bilingual-no-background.png','docs/assets/settings-page.png','docs/assets/chrome-install.png']
COMMON=RUNTIME+DOCS+['README.md','NOTICE.md','RELEASE_NOTES.md','samples/demo.en.srt','samples/README.md','开始使用.txt']
SOURCE=COMMON+['.gitignore','.gitattributes','.github/ISSUE_TEMPLATE/bug_report.yml','package.json',
               'scripts/check.mjs','scripts/package.py','tests/core.test.mjs','tests/worker-control.test.mjs','tests/background-control.test.mjs',
               'tests/caption-source.test.mjs','tests/numbers.test.mjs','tests/subtitle-validation.test.mjs','tests/worker-budget.test.mjs','tests/review.test.mjs','tests/worker-review.test.mjs','tests/recovery.test.mjs']

def validate(files):
    patterns=[re.compile(r'sk-[A-Za-z0-9_-]{20,}'),re.compile(r'gh[pousr]_[A-Za-z0-9_]{30,}'),re.compile(r'github_pat_[A-Za-z0-9_]{30,}')]
    for name in files:
        path=ROOT/name
        if not path.is_file():raise ValueError('Missing required public file: '+name)
        if path.suffix.lower() not in ('.png','.jpg','.jpeg'):
            content=path.read_text(encoding='utf-8')
            if any(pattern.search(content)for pattern in patterns):raise ValueError('Credential-like text found in '+name)
            if re.search(r'[A-Z]:\\(?:Users|CODEX)\\|/(?:Users|home)/[A-Za-z0-9_.-]+/',content):raise ValueError('Private absolute path found in '+name)
    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    required=[manifest['background']['service_worker'],manifest['options_page']]
    required.extend(script for entry in manifest['content_scripts']for script in entry['js'])
    if not all(name in RUNTIME for name in required):raise ValueError('Runtime file list does not match manifest')
    if (ROOT/'LICENSE').exists()or(ROOT/'LICENSE.md').exists():raise ValueError('License was not selected for this release; confirm before adding one')
    if len(SOURCE)>100:raise ValueError('Source package exceeds beginner web upload file count guidance')

def archive(target,files):
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as package:
        for name in files:package.write(ROOT/name,name)
    with zipfile.ZipFile(target)as package:
        if 'manifest.json'not in package.namelist():raise ValueError('Manifest must be at ZIP root')
        if any(name.startswith('extension/')for name in package.namelist()):raise ValueError('Unexpected nested extension directory')
    return hashlib.sha256(target.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description='制作普通用户安装包与GitHub源码包，无需密钥。')
    parser.add_argument('--output',type=Path,default=ROOT/'dist')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    validate(SOURCE)
    version=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))['version']
    package_version=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version']
    if package_version!=version:raise ValueError('Version mismatch')
    results=[]
    for title,files in [(f'YIHAO-Translator-v{version}.zip',COMMON),(f'YIHAO-Translator-GitHub-v{version}.zip',SOURCE)]:
        target=args.output/title;digest=archive(target,files)
        results.append({'filename':title,'files':len(files),'bytes':target.stat().st_size,'sha256':digest})
    (args.output/'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['filename']}\n"for item in results),encoding='utf-8')
    print(json.dumps({'version':version,'root_manifest':True,'no_private_files':True,'packages':results},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
