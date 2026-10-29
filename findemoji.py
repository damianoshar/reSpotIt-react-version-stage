from pathlib import Path
root=Path(r'C:/Users/Damianos/Downloads/projects/githubs/dashall/latest-versions/spotify-dash-board-python-latest/typescript/src')
emojilist=[]
for p in root.rglob('*'):
    if p.suffix not in ('.tsx','.ts','.css'): continue
    for i,line in enumerate(p.read_text(encoding='utf-8').splitlines(),1):
        emojis=[hex(ord(c)) for c in line if ord(c)>=0x1F000 or 0x2190<=ord(c)<=0x2193 or ord(c)==0x2B50]
        if emojis:
            print(p.name, i, emojis, '||', line.encode('ascii','backslashreplace').decode('ascii'))
PY
PY