"""Exercise shipped SQLite migrations and offline LED guards with real SQL."""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / 'apps' / 'desktop' / 'src-tauri' / 'migrations'
NOW = '2026-10-24T12:00:00Z'
BUSINESS = 'business'


def main() -> None:
    db = sqlite3.connect(':memory:')
    db.execute('pragma foreign_keys=on')
    db.execute('create table app_meta(key text primary key,value text not null)')
    for path in sorted(MIGRATIONS.glob('*.sql')):
        db.executescript(path.read_text(encoding='utf8'))
    db.execute('insert into authorized_context values(1,?,?,?,?,?,?,?,?)',
               ('owner', 'Owner', BUSINESS, 'CentroColor', 'branch', 'Principal', 'owner', NOW))
    offer_rate_columns = {
        row[1] for row in db.execute('pragma table_info(event_offer_rates)')
    }
    assert {'operator_amount_cents', 'with_projector_amount_cents'} <= offer_rate_columns
    db.execute(
        '''insert into travel_pricing_settings(
           id,business_id,fuel_price_cents_per_liter,efficiency_milli_km_per_liter,
           margin_basis_points,created_at,updated_at)
           values('travel',?,160000,10000,2000,?,?)''',
        (BUSINESS, NOW, NOW),
    )
    assert db.execute(
        "select count(*) from pricing_settings_outbox where entity_type='travel_pricing_setting'"
    ).fetchone()[0] == 1
    db.execute(
        "update travel_pricing_settings set margin_basis_points=2500,local_revision=local_revision+1 where id='travel'"
    )
    travel_outbox = db.execute(
        "select local_revision,status from pricing_settings_outbox where entity_type='travel_pricing_setting'"
    ).fetchone()
    assert travel_outbox == (1, 'pending')
    db.execute("insert into customers(id,business_id,full_name,is_active,created_at,updated_at,sync_origin) values('customer',?,'Cliente',1,?,?,'remote')",
               (BUSINESS, NOW, NOW))
    db.execute("insert into price_lists(id,business_id,name,kind,is_default,is_active,created_at,updated_at,sync_origin) values('public',?,'Público','public',1,1,?,?,'remote')",
               (BUSINESS, NOW, NOW))
    db.execute("insert into led_panel_pools(id,business_id,total_panels,panel_area_mm2,pixels_per_panel,is_active,created_at,updated_at,sync_origin) values('pool',?,24,500000,32768,1,?,?,'remote')",
               (BUSINESS, NOW, NOW))
    for controller in ('tb20', 'nova', 'spare'):
        db.execute('insert into resources(id,business_id,name,is_active,created_at,updated_at,sync_origin) values(?,?,?,1,?,?,\'remote\')',
                   (controller, BUSINESS, controller, NOW, NOW))
        db.execute('insert into led_controllers(id,business_id,resource_id,max_pixels,created_at,updated_at,sync_origin) values(?,?,?,650000,?,?,\'remote\')',
                   (controller, BUSINESS, controller, NOW, NOW))

    def add_event(event_id: str, controller: str, panels: int, start: str, end: str) -> None:
        db.execute('''insert into events(id,business_id,branch_id,customer_id,title,starts_at,ends_at,status,created_by,created_at,updated_at)
                      values(?,?,?,'customer','LED',?,?,'quoted','owner',?,?)''',
                   (event_id, BUSINESS, 'branch', start, end, NOW, NOW))
        db.execute('''insert into event_service_items(id,business_id,event_id,name,quantity,unit_price_cents,total_cents,
                      is_active,created_at,updated_at,price_list_id,config_snapshot)
                      values(?,?,?,'LED',1,0,0,1,?,?,'public','{"kind":"led_screen"}')''',
                   (f'{event_id}-item', BUSINESS, event_id, NOW, NOW))
        db.execute('''insert into resource_reservations(id,business_id,event_id,resource_id,starts_at,ends_at,price_cents,
                      is_active,created_at,updated_at) values(?,?,?,?,?,?,0,1,?,?)''',
                   (f'{event_id}-resource', BUSINESS, event_id, controller, start, end, NOW, NOW))
        db.execute('''insert into led_panel_reservations(id,business_id,event_id,event_service_item_id,controller_resource_id,
                      starts_at,ends_at,panels,is_active,created_at,updated_at)
                      values(?,?,?,?,?,?,?,?,1,?,?)''',
                   (f'{event_id}-panels', BUSINESS, event_id, f'{event_id}-item', controller, start, end, panels, NOW, NOW))

    start, end = '2026-11-07T18:00:00Z', '2026-11-08T02:00:00Z'
    add_event('first', 'tb20', 12, start, end)
    add_event('second', 'nova', 12, start, end)
    db.execute("update events set status='reserved' where id='first'")
    db.execute("update events set status='reserved' where id='second'")
    add_event('over', 'spare', 1, start, end)
    try:
        db.execute("update events set status='reserved' where id='over'")
        raise AssertionError('Pool overbooking was accepted')
    except sqlite3.IntegrityError as error:
        assert 'LED_POOL_CAPACITY_CONFLICT' in str(error)
    add_event('free-date', 'tb20', 12, '2026-11-09T18:00:00Z', '2026-11-10T02:00:00Z')
    db.execute("update events set status='reserved' where id='free-date'")
    assert db.execute("select count(*) from event_service_outbox where entity_type='led_panel_reservation'").fetchone()[0] == 4
    print('event_services_sqlite.py: ok')


if __name__ == '__main__':
    main()
