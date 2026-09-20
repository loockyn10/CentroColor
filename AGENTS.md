# Guía de entrada para Codex

Leer primero `docs/HANDOFF.md` y `docs/CURRENT_STATE.md`. Consultar `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/ROADMAP.md` y `docs/DECISIONS.md` según la tarea. `README.md` contiene los comandos verificados.

El Sprint 2 incorpora solo Business, Branch, Device, migraciones y adaptadores de identidad. No iniciar Sprint 3 ni implementar clientes, ventas, agenda, eventos, marquetería, autenticación completa o sincronización sin una solicitud nueva. Mantener `packages/domain` sin dependencias de UI o persistencia y ubicar los adaptadores concretos dentro de cada app.

Si colaboran varios agentes, repartir archivos o tareas sin ediciones simultáneas sobre el mismo archivo. Antes de entregar, actualizar `CURRENT_STATE.md` con hechos verificados, registrar decisiones arquitectónicas nuevas en `DECISIONS.md` y dejar en `HANDOFF.md` el punto de reanudación. No convertir planes en funcionalidades declaradas como existentes.
