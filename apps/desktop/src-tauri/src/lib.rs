use tauri_plugin_sql::{Migration, MigrationKind};

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
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:centrocolor.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running CentroColor Desktop");
}
