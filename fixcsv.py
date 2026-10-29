from pathlib import Path
p=Path(r'C:/Users/Damianos/Downloads/projects/githubs/dashall/latest-versions/spotify-dash-board-python-latest/typescript/src/components/SyncModal.tsx')
t=p.read_text(encoding='utf-8')
t=t.replace("\U0001F4C2 \nChoose CSV file", "Choose CSV file")
t=t.replace("\U0001F4C2 Choose CSV file", "Choose CSV file")
p.write_text(t, encoding='utf-8')
print('contains folder icon:', '\U0001F4C2' in t)
PY