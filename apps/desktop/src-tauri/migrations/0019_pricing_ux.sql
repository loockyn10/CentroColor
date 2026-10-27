-- PRICING-UX-02: global travel settings and explicit event commercial components.
ALTER TABLE event_offer_rates ADD COLUMN operator_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(operator_amount_cents>=0);
ALTER TABLE event_offer_rates ADD COLUMN with_projector_amount_cents INTEGER CHECK(with_projector_amount_cents IS NULL OR with_projector_amount_cents>=0);

DROP TRIGGER event_offer_rate_outbox_update;
CREATE TRIGGER event_offer_rate_outbox_update
AFTER UPDATE OF amount_cents,operator_amount_cents,with_projector_amount_cents ON event_offer_rates
WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO event_service_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'event_offer_rate',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
 local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;

CREATE TABLE travel_pricing_settings (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL UNIQUE,
 fuel_price_cents_per_liter INTEGER NOT NULL CHECK(fuel_price_cents_per_liter>0),
 efficiency_milli_km_per_liter INTEGER NOT NULL CHECK(efficiency_milli_km_per_liter>0),
 margin_basis_points INTEGER NOT NULL CHECK(margin_basis_points BETWEEN 0 AND 100000),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sync_origin TEXT NOT NULL DEFAULT 'local',
 local_revision INTEGER NOT NULL DEFAULT 0,cloud_updated_at TEXT
);

CREATE TABLE pricing_settings_outbox (
 id TEXT PRIMARY KEY NOT NULL,business_id TEXT NOT NULL,entity_type TEXT NOT NULL
 CHECK(entity_type='travel_pricing_setting'),entity_id TEXT NOT NULL,
 local_revision INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN('pending','conflict')),attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,
 remote_updated_at TEXT,remote_snapshot TEXT,created_at TEXT NOT NULL,
 UNIQUE(business_id,entity_type,entity_id)
);

CREATE TRIGGER travel_pricing_settings_outbox_insert
AFTER INSERT ON travel_pricing_settings WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO pricing_settings_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'travel_pricing_setting',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
 local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
CREATE TRIGGER travel_pricing_settings_outbox_update
AFTER UPDATE OF fuel_price_cents_per_liter,efficiency_milli_km_per_liter,margin_basis_points
ON travel_pricing_settings WHEN NEW.sync_origin='local' BEGIN
 INSERT INTO pricing_settings_outbox(id,business_id,entity_type,entity_id,local_revision,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.business_id,'travel_pricing_setting',NEW.id,NEW.local_revision,NEW.updated_at)
 ON CONFLICT(business_id,entity_type,entity_id) DO UPDATE SET
 local_revision=excluded.local_revision,status='pending',attempts=0,last_error=NULL;
END;
