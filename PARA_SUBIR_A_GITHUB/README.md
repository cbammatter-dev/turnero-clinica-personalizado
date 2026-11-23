# 🏥 Turnero Clínica — Bot de WhatsApp + Turnero Web + Google Calendar

Sistema real de gestión de turnos para una **clínica con múltiples profesionales y especialidades**, pensado para ser simple y claro para cualquier paciente.

## ¿Qué incluye este proyecto?

1. **Turnero Web para Pacientes (`/`)**:
   - Flujo en 4 pasos simples: **Especialidad → Profesional (o ⚡ Primer turno disponible) → Día y Horario → Datos**.
   - Sección **"Mis Turnos"** para confirmar, reprogramar o cancelar por DNI.
   - **Bot Web flotante** para quienes prefieren chatear.
   - Al reservar por la Web, envía automáticamente el comprobante y el recordatorio de 24 hs por WhatsApp.

2. **Bot de WhatsApp (`/webhook/whatsapp` + Simulador `/whatsapp-demo`)**:
   - Motor conversacional con botones y listas desplegables (el paciente nunca escribe fechas a mano).
   - Reconoce a pacientes recurrentes automáticamente por teléfono o DNI.
   - Incluye **Simulador de WhatsApp** en `/whatsapp-demo` conectado al mismo motor real del webhook, para probar todo el flujo y los recordatorios de 24 hs al instante.

3. **Recordatorio automático 24 hs antes (`src/services/reminderJob.js`)**:
   - Revisa la agenda periódicamente y envía un mensaje por WhatsApp con 3 botones:
     - **✅ Confirmar:** marca el turno como `Confirmado` y cambia el evento en Google Calendar a **Verde**.
     - **🔄 Modificar:** permite elegir un nuevo día y horario, mueve el evento en Google Calendar y libera el anterior.
     - **❌ Cancelar:** elimina el evento de Google Calendar y libera el horario al instante para otro paciente.

4. **Integración con Google Calendar (`src/services/googleCalendar.js`)**:
   - **1 calendario por profesional** (compartido con la cuenta de servicio de la clínica).
   - Código de colores automático: 🟡 **Amarillo** (`Reservado`), 🟢 **Verde** (`Confirmado`), 🔴 **Rojo** (`Bloqueado / No atiende`).
   - Lee eventos ocupados en tiempo real: si un médico crea un evento `"Vacaciones"` o `"Congreso"` en Google Calendar, el bot deja de ofrecer esos horarios automáticamente.
   - **Modo Dual:** funciona inmediatamente en **Modo Local/Demo** (sin credenciales) y pasa a **Modo Live** apenas completás `.env`.

5. **Panel de Recepción (`/admin`)**:
   - Vista de todos los turnos, filtros por fecha/profesional/estado, gestión de profesionales y Google Calendar IDs, bloqueos de agenda y botón **"⏰ 24h"** para disparar un recordatorio de prueba en 1 clic.

---

## Cómo ejecutarlo ahora mismo

1. Copiá `.env.example` a `.env` (opcional para empezar en modo demo):
   ```powershell
   copy .env.example .env
   ```
2. Iniciá el servidor:
   ```powershell
   npm.cmd start
   ```
3. Abrí en tu navegador:
   - **Turnero Web:** http://localhost:3000/
   - **Simulador Bot WhatsApp:** http://localhost:3000/whatsapp-demo
   - **Panel de Recepción:** http://localhost:3000/admin

---

## Cómo conectar Google Calendar (Real / Producción)

El método recomendado para clínicas es usar una **Cuenta de Servicio (Service Account)** para que nunca venzan las sesiones:

1. Entrá a [Google Cloud Console](https://console.cloud.google.com/), creá un proyecto (ej. `Turnero Clinica`) y habilitá la **Google Calendar API**.
2. En **IAM y administración → Cuentas de servicio**, creá una cuenta de servicio y descargá su clave JSON (guardala como `service-account.json` en la raíz del proyecto, o copiá `client_email` y `private_key` en `.env`).
3. En **Google Calendar** (desde la cuenta central de la clínica):
   - Creá un calendario por cada profesional (ej. `Dra. Laura Gómez - Clínica Médica`).
   - En la configuración de cada calendario → **Compartir con personas determinadas**, agregá el email de la cuenta de servicio (`...@...iam.gserviceaccount.com`) con permiso **"Hacer cambios en eventos"**.
   - Copiá el **ID del calendario** (sección *Integrar el calendario*) y pegalo en `/admin` en la fila de ese profesional.
4. En `.env`, configurá:
   ```env
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
   ```
   Reiniciá el servidor y verás `📅 Google Calendar: ✅ CONECTADO (LIVE)`.

---

## Cómo conectar WhatsApp Real (Meta WhatsApp Cloud API)

1. Creá una app en [Meta for Developers](https://developers.facebook.com/) y activá el producto **WhatsApp**.
2. Copiá el **Phone Number ID** y el **Token de acceso permanente** en tu `.env`:
   ```env
   WHATSAPP_ACCESS_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=123456789012345
   WHATSAPP_VERIFY_TOKEN=mi_token_secreto_clinica_2026
   ```
3. Exponé tu servidor con HTTPS (por ejemplo, desplegándolo en **Render**, **Railway** o un VPS) y configurá el Webhook en Meta:
   - **URL de devolución de llamada:** `https://tu-dominio.com/webhook/whatsapp`
   - **Token de verificación:** el mismo valor de `WHATSAPP_VERIFY_TOKEN`
   - Suscribite al campo `messages`.
4. Creá la **Plantilla de Recordatorio 24 hs** en WhatsApp Manager con el nombre `recordatorio_turno_24h` (Categoría: *Utilidad*, Idioma: *Español (ARG)*):
   - **Cuerpo:**
     > ¡Hola, {{1}}! 👋 Te recordamos tu turno de mañana {{2}} a las {{3}} con {{4}} en {{5}}. Por favor confirmanos si vas a asistir:
   - **Botones de respuesta rápida (3):**
     1. `✅ Confirmar`
     2. `🔄 Modificar`
     3. `❌ Cancelar`
