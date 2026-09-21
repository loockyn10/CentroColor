use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::{str::FromStr, time::Duration};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleInput {
    id: String,
    business_id: String,
    branch_id: String,
    device_id: Option<String>,
    created_by: String,
    status: String,
    subtotal_cents: i64,
    total_cents: i64,
    payment_method: String,
    created_at: String,
    updated_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleItemInput {
    id: String,
    sale_id: String,
    product_id: Option<String>,
    product_name: String,
    barcode: Option<String>,
    unit_price_cents: i64,
    quantity: i64,
    total_cents: i64,
}

#[tauri::command]
async fn complete_local_sale(
    app: tauri::AppHandle,
    sale: SaleInput,
    items: Vec<SaleItemInput>,
) -> Result<(), String> {
    if sale.status != "completed"
        || items.is_empty()
        || sale.total_cents < 0
        || sale.subtotal_cents != sale.total_cents
        || !["cash", "debit", "credit", "transfer", "other"].contains(&sale.payment_method.as_str())
    {
        return Err("Venta inválida.".into());
    }
    let mut sum = 0_i64;
    for item in &items {
        if item.sale_id != sale.id
            || item.product_name.trim().is_empty()
            || item.quantity <= 0
            || item.unit_price_cents < 0
            || item.unit_price_cents.checked_mul(item.quantity) != Some(item.total_cents)
        {
            return Err("Línea de venta inválida.".into());
        }
        sum = sum
            .checked_add(item.total_cents)
            .ok_or("Total fuera de rango.")?;
    }
    if sum != sale.total_cents || sum > 9_007_199_254_740_991 {
        return Err("El total no coincide con las líneas.".into());
    }

    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("centrocolor.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path.display()))
        .map_err(|error| error.to_string())?
        .create_if_missing(false)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| error.to_string())?;
    let mut tx = connection
        .begin()
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO sales (id, business_id, branch_id, device_id, created_by, status, subtotal_cents, total_cents, payment_method, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&sale.id).bind(&sale.business_id).bind(&sale.branch_id).bind(&sale.device_id)
        .bind(&sale.created_by).bind(&sale.status).bind(sale.subtotal_cents).bind(sale.total_cents)
        .bind(&sale.payment_method).bind(&sale.created_at).bind(&sale.updated_at)
        .execute(&mut *tx).await.map_err(|error| error.to_string())?;
    for item in &items {
        sqlx::query("INSERT INTO sale_items (id, business_id, sale_id, product_id, product_name, barcode, unit_price_cents, quantity, total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&item.id).bind(&sale.business_id).bind(&item.sale_id).bind(&item.product_id)
            .bind(&item.product_name).bind(&item.barcode).bind(item.unit_price_cents)
            .bind(item.quantity).bind(item.total_cents)
            .execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_app_meta",
            sql: "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_identity_tables",
            sql: include_str!("../migrations/0002_identity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_authorized_context",
            sql: include_str!("../migrations/0003_authorized_context.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_customers",
            sql: include_str!("../migrations/0004_customers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_customer_sync",
            sql: include_str!("../migrations/0005_customer_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_pos_tables",
            sql: include_str!("../migrations/0006_pos.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![complete_local_sale])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:centrocolor.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running CentroColor Desktop");
}
