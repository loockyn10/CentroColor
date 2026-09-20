# Guía de entrada para Claude Code

Empezar por `docs/HANDOFF.md` y `docs/CURRENT_STATE.md`. Usar `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/ROADMAP.md` y `docs/DECISIONS.md` como contexto; los comandos están en `README.md`.

Respetar el límite del Sprint 3: existe identidad estructural, autenticación Supabase, memberships, RLS y contexto offline limitado en Desktop; las funciones de negocio siguen como demostración. No iniciar Sprint 4 sin instrucción expresa. Conservar la separación entre `domain`, `application`, adaptadores de las apps, `ui` y `features`.

En trabajo con varios agentes, evitar ediciones concurrentes del mismo archivo. Al finalizar cambios, actualizar estado verificado, decisiones nuevas y handoff sin duplicar el contenido extenso de los otros documentos.
