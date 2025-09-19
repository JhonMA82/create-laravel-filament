# Laravel Filament Installer · CLI

[![Node.js](https://img.shields.io/badge/Node-%E2%89%A518.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](package.json)
[![CLI: Commander](https://img.shields.io/badge/CLI-Commander-8A2BE2)](src/cli/program.js)
[![Prompts: Clack](https://img.shields.io/badge/Prompts-Clack-00BFA5)](src/commands/create.js)
[![Tasks: Listr2](https://img.shields.io/badge/Tasks-Listr2-FF6F00)](src/commands/create.js)

Asistente de línea de comandos para crear y configurar proyectos Laravel + Filament con starter kits (React/Vue/Livewire) y distintas opciones de base de datos (SQLite/Supabase/MySQL/PostgreSQL), con prompts interactivos (Clack), parsing de banderas (Commander) y orquestación de tareas (Listr2).

---

## 📋 Índice

- [🎯 Descripción General](#-descripción-general)
- [✨ Características](#-características)
- [🧰 Requisitos](#-requisitos)
- [🔧 Instalación](#-instalación)
- [💡 Uso](#-uso)
  - [Modo interactivo](#modo-interactivo)
  - [Modo no interactivo (CI)](#modo-no-interactivo-ci)
  - [Ayuda](#ayuda)
- [🧾 Salida JSON](#-salida-json)
- [🎛️ TTY y Colores](#️-tty-y-colores)
- [🗂️ Flujo de Tareas](#️-flujo-de-tareas)
- [🏗️ Arquitectura Interna](#️-arquitectura-interna)
- [🤝 Contribuir](#-contribuir)
- [🛠️ Tecnologías](#️-tecnologías)
- [📄 Licencia](#-licencia)

---

## 🎯 Descripción General

Este CLI automatiza la creación de un proyecto Laravel + Filament listo para trabajar, incluyendo:

- Scaffold del proyecto con Laravel Installer
- Configuración de base de datos y `.env`
- Instalación y bootstrap de Filament
- Herramientas de desarrollo: Pest, Laravel Boost, Larastan, Debugbar, Laravel Lang
- Calidad de código: Pint, Rector
- Frontend (Node + Vite) y build inicial
- Localización en español
- Tareas de verificación (phpstan, pest, pint, rector) y commit inicial

Entrypoint del binario: [index.js](index.js)  
Registro del CLI y banderas globales con Commander: [JavaScript.buildProgram()](src/cli/program.js:9) y ejecución: [JavaScript.runCli()](src/cli/program.js:63)  
Ejecución del flujo create (prompts + pipeline de tareas): [JavaScript.runCreate()](src/commands/create.js:353) y prompts: [JavaScript.interactiveGather()](src/commands/create.js:183)

---

## ✨ Características

- 🚀 Creación guiada con prompts (Clack) cuando hay TTY
- 🧭 Modo no interactivo para CI con banderas completas
- 🧩 Starter kits: React, Vue, Livewire
- 🗄️ Bases de datos: SQLite, Supabase (PostgreSQL), MySQL, PostgreSQL
- 📦 Instalación de herramientas de testing, dev y calidad
- 📑 Salida JSON estable para automatización
- 🎨 Colores opcionales, controlados por flags y contexto TTY
- 🧵 Orquestación de tareas con feedback conciso (Listr2)

---

## 🧰 Requisitos

- Node.js 18+ y npm (se recomienda la versión LTS 18/20)
- Git
- Laravel Herd (incluye PHP/Composer y el comando `herd`)
- Docker Desktop en ejecución (solo requerido si eliges Supabase)
- Acceso a Composer/CLI de PHP (provistos por Herd)
- Para MySQL/PostgreSQL: un servidor accesible y credenciales válidas

Notas:
- El CLI verifica y usa `herd` como entorno de PHP/Composer.
- Para Supabase, se instala el CLI vía npm y requiere Docker en ejecución.

---

## 🔧 Instalación

Clona el repositorio e instala dependencias:

```bash
git clone <URL de tu repo>
cd LaravelInstaller
npm install
```

Opciones para ejecutar:

- Local (recomendado durante desarrollo):
```bash
node index.js
```

- Instalar como bin global (para usar create-laravel-filament):
```bash
npm link
create-laravel-filament
```

- Ejecutar con npm script (si defines uno):
```bash
npm start
```

---

## 💡 Uso

### Modo interactivo

Ejecuta el CLI sin banderas; se mostrarán prompts para nombre del proyecto, starter kit, base de datos y (si aplica) credenciales de conexión.

```bash
node index.js
```

Ejemplo de flujo:
- Starter kit: React/Vue/Livewire (select)
- Base de datos: SQLite/Supabase/MySQL/PostgreSQL (select)
- Para MySQL/PostgreSQL, se piden host/port/db/user/password
- Confirmación final y ejecución de tareas

### Modo no interactivo (CI)

Proporciona todas las banderas necesarias. Si falta algún dato requerido con `--non-interactive`, el CLI falla con código 1 (o emite JSON de error con `--json`).

- SQLite:
```bash
node index.js create \
  --non-interactive \
  --project-name app \
  --starter-kit react \
  --db sqlite \
  -y
```

- MySQL:
```bash
node index.js create \
  --non-interactive \
  --project-name app \
  --starter-kit vue \
  --db mysql \
  --db-host 127.0.0.1 \
  --db-port 3306 \
  --db-name laravel \
  --db-user root \
  --db-password secret \
  --filament-name Admin \
  --filament-email admin@admin.com \
  --filament-password password
```

- Supabase (requiere Docker en ejecución):
```bash
node index.js create \
  --non-interactive \
  --project-name app \
  --starter-kit livewire \
  --db supabase
```

### Ayuda

```bash
node index.js --help
node index.js create --help
```

---

## 🧾 Salida JSON

Con `--json` el CLI imprime un único objeto JSON en stdout y suprime colores y prompts.

```bash
node index.js create --json --non-interactive \
  --project-name app \
  --starter-kit react \
  --db sqlite
```

Ejemplo (resumido):
```json
{
  "version": "1.0.0",
  "command": "create",
  "flags": { "json": true, "nonInteractive": true, "yes": false, "verbose": false },
  "environment": { "tty": false, "node": "v20.11.1", "platform": "win32" },
  "input": {
    "projectName": "app",
    "starterKit": "react",
    "db": "sqlite",
    "dbConn": null,
    "herdDir": "C:\\Users\\JUAN\\Herd",
    "filament": { "name": "Admin", "email": "admin@admin.com" }
  },
  "tasks": [
    { "index": 0, "name": "prechecks", "status": "success", "durationMs": 120 },
    { "index": 1, "name": "laravel_new", "status": "success", "durationMs": 42500 }
  ],
  "result": {
    "status": "success",
    "projectPath": "C:\\Users\\JUAN\\Herd\\app",
    "dbLabel": "SQLite",
    "supabase": null
  },
  "metrics": { "totalDurationMs": 89000 }
}
```

---

## 🎛️ TTY y Colores

Banderas globales:
- `--json`: salida JSON; desactiva prompts y colores
- `--no-color` / `--color`: deshabilita o fuerza colores si el terminal lo soporta
- `-y, --yes`: acepta valores por defecto en prompts
- `--non-interactive`: desactiva prompts; requiere banderas completas
- `--verbose`: salida más detallada (útil en CI o debugging)

Reglas:
- Sin TTY o con `--json`: no hay prompts; renderer silencioso
- Con TTY e interactivo: prompts Clack y renderer por defecto

---

## 🗂️ Flujo de Tareas

El pipeline orquestado con Listr2 ejecuta, en orden:

1. Prechequeos (verifica `herd`, ajusta directorio de trabajo)
2. Scaffold del proyecto (Laravel Installer, `laravel new`)
3. Base de datos y entorno:
   - SQLite: configura `.env` y crea `database.sqlite`
   - Supabase: instala CLI, `supabase init` y `supabase start` (requiere Docker)
   - MySQL/PostgreSQL: actualiza `.env` con los valores proporcionados
   - `php artisan migrate`
4. Filament: instalación, paneles, usuario, resource User
5. Pruebas: instalación de Pest
6. Herramientas de desarrollo: Laravel Boost, Larastan, Debugbar, Laravel Lang
7. Calidad de código: Pint + archivo, Rector + archivo
8. Essentials: repo VCS, require, vendor:publish
9. Frontend: `npm install`, plugin Vite React/Vue si aplica, `npm run build`
10. Localización ES: `php artisan lang:add es` y `lang:update`
11. Pre-commit: `phpstan`, `pest`, `pint`, `rector process`
12. Git: `git add .` y commit inicial

---

## 🏗️ Arquitectura Interna

- Bootstrap del binario: [index.js](index.js)
- Definición del CLI y banderas:
  - [JavaScript.buildProgram()](src/cli/program.js:9)
  - [JavaScript.runCli()](src/cli/program.js:63)
- Comando `create`:
  - Prompts interactivos: [JavaScript.interactiveGather()](src/commands/create.js:183)
  - Pipeline de tareas + salida JSON: [JavaScript.runCreate()](src/commands/create.js:353)

Archivos relevantes:
- [package.json](package.json)
- [src/cli/program.js](src/cli/program.js)
- [src/commands/create.js](src/commands/create.js)

---

## 🤝 Contribuir

- Issues y PRs son bienvenidos.
- Requisitos de desarrollo:
  - Node.js 18+
  - npm
- Flujo sugerido:
```bash
git clone <URL de tu repo>
cd LaravelInstaller
npm install
node index.js --help
```
- Estilo:
  - ESM (type: module), Commander para CLI, Clack para prompts, Listr2 para tareas
  - Mantener salida JSON estable al agregar/modificar tareas
- Antes de enviar PR:
  - Prueba los tres modos: interactivo, no interactivo y `--json`
  - Verifica que la ayuda (`--help`) refleje tus cambios

---

## 🛠️ Tecnologías

- Node.js, npm
- [Commander](src/cli/program.js) (parsing y estructura de comandos)
- [Clack](src/commands/create.js) (prompts)
- [Listr2](src/commands/create.js) (orquestación de tareas)
- execa, chalk, boxen, cli-table3 (UI/CLI y utilidades)

---

## 📄 Licencia

ISC — ver [package.json](package.json). Si tu distribución requiere el archivo de licencia dedicado, añade un `LICENSE` con el texto de la licencia ISC correspondiente.
