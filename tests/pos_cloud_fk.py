"""Check that every new composite FK has an explicit matching unique key."""

import re
from pathlib import Path

root = Path('supabase/migrations')
identity = (root / '20260919000000_identity_foundation.sql').read_text(encoding='utf-8')
pos = (root / '20260923000000_pos_mvp.sql').read_text(encoding='utf-8')
sql = identity + '\n' + pos

tables = {
    name: body
    for name, body in re.findall(
        r'create\s+table\s+public\.(\w+)\s*\((.*?)\n\);',
        sql,
        re.IGNORECASE | re.DOTALL,
    )
}

def columns(value):
    return tuple(column.strip().lower() for column in value.split(','))

keys = {}
for name, body in tables.items():
    keys[name] = {
        columns(value)
        for value in re.findall(r'\bunique\s*\(([^)]+)\)', body, re.IGNORECASE)
    }

for name, value in re.findall(
    r'alter\s+table\s+public\.(\w+)\s+add\s+constraint\s+\w+\s+unique\s*\(([^)]+)\)',
    pos,
    re.IGNORECASE,
):
    keys[name].add(columns(value))

references = re.findall(
    r'foreign\s+key\s*\(([^)]+)\)\s*references\s+public\.(\w+)\s*\(([^)]+)\)',
    pos,
    re.IGNORECASE,
)
assert references, 'No composite foreign keys found in POS migration'
for source, target, referenced in references:
    assert columns(referenced) in keys[target], (
        f'FK ({source}) references {target}({referenced}) without a matching unique key'
    )

guard = pos[:pos.index('create table public.product_categories')]
assert 'if not exists' in guard and 'pg_catalog.pg_index' in guard
for required in ('i.indisunique', 'i.indisvalid', 'i.indimmediate',
                 'i.indpred is null', 'i.indexprs is null', 'i.indnkeyatts = 2',
                 'i.indkey[0]', 'i.indkey[1]'):
    assert required in guard, f'device key guard omits {required}'
assert pos.index('add constraint devices_business_id_id_pos_unique') < pos.index('create table public.sales')
assert 'product_categories_business_name_idx' not in pos, 'category UNIQUE already supplies this index'
print(f'POS Cloud FK keys: {len(references)} composite references have matching unique keys')
