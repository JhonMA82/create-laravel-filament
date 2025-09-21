import * as p from '@clack/prompts'
import chalk from 'chalk'
import commandExists from 'command-exists'
import { execa } from 'execa'
import { promises as fs } from 'fs'
import { Listr } from 'listr2'
import net from 'net'
import os from 'os'
import path from 'path'
import process from 'process'

/**
 * Helpers
 */
function isTTY() {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY)
}

function colorsEnabled(ctx) {
  if (ctx.json) return false
  if (ctx.noColor === true) return false
  if (ctx.color === false) return false
  if (!isTTY()) return false
  if (ctx.color === true) return true
  return true
}

function truncate(str = '', max = 8192) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + `\\n... [truncated ${str.length - max} chars]` : str
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function getHerdDirectory(preferred) {
  const herdDir = preferred || path.join(os.homedir(), 'Herd')
  try {
    await fs.access(herdDir)
  } catch {
    await fs.mkdir(herdDir, { recursive: true })
  }
  return herdDir
}

async function isPortOpen(host, port, timeout = 1200) {
  return await new Promise(resolve => {
    const socket = new net.Socket()
    const done = result => {
      try {
        socket.destroy()
      } catch {}
      resolve(result)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
    try {
      socket.connect(Number(port), host)
    } catch {
      done(false)
    }
  })
}

async function detectMysqlService(host, port) {
  const h = host || '127.0.0.1'
  const p = Number(port) || 3306
  return isPortOpen(h, p, 1200)
}

async function detectPostgresService(host, port) {
  const h = host || '127.0.0.1'
  const p = Number(port) || 5432
  return isPortOpen(h, p, 1200)
}

async function updateEnvValues(projectPath, updates) {
  const envPath = path.join(projectPath, '.env')
  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf8')
  } catch {
    // .env no existe (a veces tras laravel new aún no está copiado). Creamos uno nuevo.
    content = ''
  }
  let lines = content.split('\n')
  const keysFound = new Set()
  lines = lines.map(line => {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('#') || !trimmedLine.includes('=')) return line
    const key = trimmedLine.split('=')[0]
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      keysFound.add(key)
      return `${key}=${updates[key]}`
    }
    return line
  })
  for (const [key, value] of Object.entries(updates)) {
    if (!keysFound.has(key)) lines.push(`${key}=${value}`)
  }
  await fs.writeFile(envPath, lines.join('\n'))
}

async function maybeCreateSqliteDatabase(projectPath) {
  const dbFile = path.join(projectPath, 'database', 'database.sqlite')
  await fs.mkdir(path.dirname(dbFile), { recursive: true })
  await fs.writeFile(dbFile, '')
}

async function setAppLocaleEs(projectPath) {
  await updateEnvValues(projectPath, { APP_LOCALE: 'es' })
}

async function ensurePhpunitAppLocaleEn(projectPath) {
  const candidates = [path.join(projectPath, 'phpunit.xml'), path.join(projectPath, 'phpunit.xml.dist')]
  let phpunitPath = null
  for (const pth of candidates) {
    try {
      await fs.access(pth)
      phpunitPath = pth
      break
    } catch {}
  }
  if (!phpunitPath) return
  let xmlData = await fs.readFile(phpunitPath, 'utf-8')
  xmlData = xmlData.replace(/<phpunit([^>]*)>/i, (match, attrs) => {
    if (!attrs.includes('colors=')) return `<phpunit${attrs} colors="true">`
    return match.replace(/colors\\s*=\\s*["']?[^"']*["']?/i, 'colors="true"')
  })
  if (xmlData.includes('name="APP_LOCALE"')) {
    xmlData = xmlData.replace(/<env\\s+name="APP_LOCALE"\\s+value="[^"]*"/i, 'env name="APP_LOCALE" value="en"')
  } else {
    xmlData = xmlData.replace(/<php>/i, '<php><env name="APP_LOCALE" value="en"/>')
  }
  await fs.writeFile(phpunitPath, xmlData)
}

async function createPhpstanFile(projectPath) {
  const content = `includes:
    - vendor/larastan/larastan/extension.neon
parameters:
    paths:
        - app/
    level: 5`
  await fs.writeFile(path.join(projectPath, 'phpstan.neon'), content)
}

async function createPintFile(projectPath) {
  const content = `{
  "preset": "laravel"
}`
  await fs.writeFile(path.join(projectPath, 'pint.json'), content)
}

async function createRectorFile(projectPath) {
  const content = `<?php

declare(strict_types=1);

use Rector\\Config\\RectorConfig;
use Rector\\Php83\\Rector\\ClassMethod\\AddOverrideAttributeToOverriddenMethodsRector;

return RectorConfig::configure()
    ->withPhpSets()
    ->withSkip([
        AddOverrideAttributeToOverriddenMethodsRector::class,
    ])
    ->withPaths([
        __DIR__.'/app',
    ])
    ->withPreparedSets(
        deadCode: true,
        codeQuality: true,
    );`
  await fs.writeFile(path.join(projectPath, 'rector.php'), content)
}

/**
 * Detecta si existen migraciones con columnas two_factor_* en el proyecto.
 */
async function detectTwoFactorColumnsInMigrations(projectPath) {
  const migrationsDir = path.join(projectPath, 'database', 'migrations')
  try {
    const entries = await fs.readdir(migrationsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.php')) continue
      const full = path.join(migrationsDir, entry.name)
      const data = await fs.readFile(full, 'utf8')
      if (
        data.includes('two_factor_secret') ||
        data.includes('two_factor_recovery_codes') ||
        data.includes('two_factor_confirmed_at') ||
        data.includes('two_factor_')
      ) {
        return true
      }
    }
  } catch {}
  return false
}

/**
 * Parchea database/factories/UserFactory.php agregando valores por defecto (null)
 * para columnas 2FA si aún no existen.
 */
async function patchUserFactoryTwoFactorDefaults(projectPath) {
  const factoryPath = path.join(projectPath, 'database', 'factories', 'UserFactory.php')
  let content
  try {
    content = await fs.readFile(factoryPath, 'utf8')
  } catch {
    return { patched: false, reason: 'factory_not_found' }
  }

  if (
    content.includes('two_factor_secret') ||
    content.includes('two_factor_recovery_codes') ||
    content.includes('two_factor_confirmed_at')
  ) {
    return { patched: false, reason: 'already_present' }
  }

  // Buscar el bloque: línea con "return [" y su cierre "];" más cercano
  const startRe = /^[ \t]*return\s*\[/m
  const startMatch = startRe.exec(content)
  if (!startMatch) {
    return { patched: false, reason: 'array_not_found' }
  }

  const startIdx = startMatch.index
  const indent = (startMatch[0].match(/^[ \t]*/) || [''])[0]

  const afterStart = content.slice(startIdx)
  const endRe = /^[ \t]*\];/m
  const endMatch = endRe.exec(afterStart)
  if (!endMatch) {
    return { patched: false, reason: 'array_end_not_found' }
  }

  const arrStart = startIdx + startMatch[0].length
  const arrEnd = startIdx + endMatch.index
  let arr = content.slice(arrStart, arrEnd)

  // Asegurar coma final antes de inyectar nuevas líneas
  if (!arr.trimEnd().endsWith(',')) {
    arr = arr.replace(/\s*$/, ',\n')
  }

  const injectionIndent = indent + '    '
  const injection =
    `${injectionIndent}'two_factor_secret' => null,\n` +
    `${injectionIndent}'two_factor_recovery_codes' => null,\n` +
    `${injectionIndent}'two_factor_confirmed_at' => null,\n`

  const newContent = content.slice(0, arrStart) + arr + injection + content.slice(arrEnd)

  if (newContent === content) {
    return { patched: false, reason: 'replace_noop' }
  }

  await fs.writeFile(factoryPath, newContent)
  return { patched: true }
}

async function run(cmd, opts = {}) {
  const { cwd, env } = opts
  const startedAt = Date.now()
  try {
    const { stdout, stderr } = await execa(cmd, { shell: true, cwd, env })
    return {
      status: 'success',
      durationMs: Date.now() - startedAt,
      stdout: truncate(stdout),
      stderr: truncate(stderr),
    }
  } catch (error) {
    return {
      status: 'error',
      durationMs: Date.now() - startedAt,
      stdout: truncate(error.stdout),
      stderr: truncate(error.stderr || error.message),
      error,
    }
  }
}

function dbLabelOf(db) {
  switch (db) {
    case 'sqlite':
      return 'SQLite'
    case 'supabase':
      return 'Supabase (PostgreSQL)'
    case 'mysql':
      return 'MySQL'
    case 'postgresql':
      return 'PostgreSQL'
    default:
      return db
  }
}
/**
 * Muestra un menú al finalizar el proceso con opciones para el usuario
 */
async function showFinalMenu(projectPath, colorOn) {
  const { select } = await import('@clack/prompts')

  const option = await select({
    message: '🎯 ¿Qué te gustaría hacer ahora?',
    options: [
      { value: 'vscode', label: 'Abrir VS Code' },
      { value: 'exit', label: 'No hacer nada y terminar' },
    ],
  })

  return option
}

/**
 * Abre VS Code en el directorio especificado
 */
async function openVSCode(projectPath) {
  const { execa } = await import('execa')

  try {
    await execa('code', [projectPath], { shell: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Prompts con Clack (interactivo)
 */
async function interactiveGather(input, globalFlags) {
  p.intro('Asistente de Instalación de Proyectos Laravel + Filament')

  const projectName =
    input.projectName ||
    (await p.text({
      message: 'Nombre del proyecto Laravel',
      placeholder: 'mi-proyecto',
      validate: v => (v && v.trim().length ? undefined : 'El nombre no puede estar vacío'),
    }))
  if (p.isCancel(projectName)) {
    p.cancel('Cancelado por el usuario')
    process.exit(0)
  }

  const starterKit =
    input.starterKit ||
    (await p.select({
      message: 'Selecciona el starter kit',
      options: [
        { value: 'react', label: 'React' },
        { value: 'vue', label: 'Vue' },
        { value: 'livewire', label: 'Livewire' },
      ],
      initialValue: 'react',
    }))
  if (p.isCancel(starterKit)) {
    p.cancel('Cancelado por el usuario')
    process.exit(0)
  }

  const db =
    input.db ||
    (await p.select({
      message: 'Selecciona la base de datos',
      options: [
        { value: 'sqlite', label: 'SQLite' },
        { value: 'supabase', label: 'Supabase (PostgreSQL)' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'postgresql', label: 'PostgreSQL' },
      ],
      initialValue: 'sqlite',
    }))
  if (p.isCancel(db)) {
    p.cancel('Cancelado por el usuario')
    process.exit(0)
  }

  let dbConn = {
    host: input.dbHost,
    port: input.dbPort,
    name: input.dbName,
    user: input.dbUser,
    password: input.dbPassword,
  }
  if (db === 'mysql' || db === 'postgresql') {
    // Advertencia previa: detección rápida del servicio en host/puerto por defecto
    const defaultHost = '127.0.0.1'
    const defaultPort = db === 'mysql' ? '3306' : '5432'
    const detected =
      db === 'mysql'
        ? await detectMysqlService(defaultHost, defaultPort)
        : await detectPostgresService(defaultHost, defaultPort)
    if (!detected) {
      p.note(
        chalk.yellow(
          `No se detectó un servicio ${db.toUpperCase()} escuchando en ${defaultHost}:${defaultPort}.
Si tu servicio está en otra máquina o puerto, podrás indicarlo en los siguientes campos.
Asegúrate de tener la base de datos en ejecución antes de continuar para evitar fallos en las migraciones.`,
        ),
        chalk.yellow('IMPORTANTE'),
      )
    }

    dbConn.host =
      dbConn.host ||
      (await p.text({ message: `${db.toUpperCase()} host`, placeholder: '127.0.0.1', initialValue: '127.0.0.1' }))
    if (p.isCancel(dbConn.host)) process.exit(0)
    dbConn.port =
      dbConn.port ||
      (await p.text({
        message: `${db.toUpperCase()} port`,
        placeholder: db === 'mysql' ? '3306' : '5432',
        initialValue: db === 'mysql' ? '3306' : '5432',
      }))
    if (p.isCancel(dbConn.port)) process.exit(0)
    dbConn.name =
      dbConn.name ||
      (await p.text({ message: `${db.toUpperCase()} database`, placeholder: 'laravel', initialValue: 'laravel' }))
    if (p.isCancel(dbConn.name)) process.exit(0)
    dbConn.user =
      dbConn.user ||
      (await p.text({
        message: `${db.toUpperCase()} username`,
        placeholder: db === 'mysql' ? 'root' : 'postgres',
        initialValue: db === 'mysql' ? 'root' : 'postgres',
      }))
    if (p.isCancel(dbConn.user)) process.exit(0)
    dbConn.password = dbConn.password || (await p.password({ message: `${db.toUpperCase()} password` }))
    if (p.isCancel(dbConn.password)) process.exit(0)
  }
  // Advertencia si no hay servicio MySQL/PostgreSQL activo (validando con los datos ingresados)
  if (db === 'mysql' || db === 'postgresql') {
    const listening =
      db === 'mysql'
        ? await detectMysqlService(dbConn.host, dbConn.port)
        : await detectPostgresService(dbConn.host, dbConn.port)
    if (!listening) {
      p.note(
        chalk.red(
          `No se detectó un servicio ${db.toUpperCase()} escuchando en ${dbConn.host}:${dbConn.port}.
Asegúrate de iniciarlo antes de continuar o las migraciones pueden fallar.`,
        ),
        chalk.red('Nota'),
      )
    }
  }

  const useDefaults =
    globalFlags.yes ||
    (await p.confirm({
      message: '¿Usar credenciales por defecto de Filament? (Admin / admin@admin.com / password)',
      initialValue: true,
    }))
  if (p.isCancel(useDefaults)) process.exit(0)

  let filament = {
    name: input.filamentName,
    email: input.filamentEmail,
    password: input.filamentPassword,
  }
  if (useDefaults) {
    filament = {
      name: 'Admin',
      email: 'admin@admin.com',
      password: 'password',
    }
  } else {
    filament.name =
      filament.name ||
      (await p.text({ message: 'Nombre de usuario Filament', validate: v => (v ? undefined : 'Requerido') }))
    if (p.isCancel(filament.name)) process.exit(0)
    filament.email =
      filament.email ||
      (await p.text({
        message: 'Correo Filament',
        validate: v => (v && v.includes('@') ? undefined : 'Correo inválido'),
      }))
    if (p.isCancel(filament.email)) process.exit(0)
    filament.password =
      filament.password ||
      (await p.password({
        message: 'Contraseña Filament',
        validate: v => (v && v.length >= 8 ? undefined : 'Mínimo 8 caracteres'),
      }))
    if (p.isCancel(filament.password)) process.exit(0)
  }

  const herdDir = input.herdDir || (await getHerdDirectory())

  p.note(
    `Proyecto: ${projectName}
Starter kit: ${starterKit}
Base de datos: ${db}
Herd dir: ${herdDir}
Filament: ${useDefaults ? 'por defecto' : 'custom'}`,
    'Resumen',
  )

  const proceed = await p.confirm({ message: '¿Deseas continuar con estos parámetros?', initialValue: true })
  if (p.isCancel(proceed) || !proceed) {
    p.cancel('Cancelado por el usuario')
    process.exit(0)
  }

  p.outro('Iniciando instalación...')

  return { projectName, starterKit, db, dbConn, filament, herdDir }
}

/**
 * Validación de flags en modo no interactivo
 */
function validateNonInteractive(input) {
  const missing = []
  if (!input.projectName) missing.push('--project-name')
  if (!input.starterKit) missing.push('--starter-kit')
  if (!input.db) missing.push('--db')
  if (input.db === 'mysql' || input.db === 'postgresql') {
    if (!input.dbHost) missing.push('--db-host')
    if (!input.dbPort) missing.push('--db-port')
    if (!input.dbName) missing.push('--db-name')
    if (!input.dbUser) missing.push('--db-user')
    if (!input.dbPassword) missing.push('--db-password')
  }
  if (!input.filamentName) missing.push('--filament-name')
  if (!input.filamentEmail) missing.push('--filament-email')
  if (!input.filamentPassword) missing.push('--filament-password')
  return missing
}

/**
 * Orquestación principal con Listr2
 */
export async function runCreate(ctx = {}) {
  const {
    json = false,
    nonInteractive = false,
    yes = false,
    verbose = false,
    color, // may be true if --color
    noColor, // true if --no-color
    projectName,
    starterKit,
    db,
    dbHost,
    dbPort,
    dbName,
    dbUser,
    dbPassword,
    herdDir,
    filamentName,
    filamentEmail,
    filamentPassword,
  } = ctx

  const tty = isTTY()
  const interactive = !json && !nonInteractive && tty
  const colorOn = colorsEnabled({ json, noColor, color })
  if (!colorOn) {
    process.env.FORCE_COLOR = '0'
    process.env.NO_COLOR = '1'
  } else if (color === true) {
    process.env.FORCE_COLOR = '1'
  }

  // Preparar input inicial
  let input = {
    projectName,
    starterKit,
    db,
    dbHost,
    dbPort,
    dbName,
    dbUser,
    dbPassword,
    herdDir,
    filamentName,
    filamentEmail,
    filamentPassword,
  }

  let answers
  if (interactive) {
    answers = await interactiveGather(input, { yes })
  } else {
    // No interactivo
    // Defaults razonables si faltan (cuando aplicable)
    input.starterKit = input.starterKit || 'react'
    input.db = input.db || 'sqlite'
    if (!nonInteractive) {
      // Si el usuario no pidió strictly --non-interactive, permitimos defaults para Filament
      input.filamentName = input.filamentName || 'Admin'
      input.filamentEmail = input.filamentEmail || 'admin@admin.com'
      input.filamentPassword = input.filamentPassword || 'password'
    }
    const missing = validateNonInteractive({
      ...input,
      filamentName: input.filamentName,
      filamentEmail: input.filamentEmail,
      filamentPassword: input.filamentPassword,
    })
    if (missing.length > 0) {
      const message = `Faltan banderas requeridas en modo no interactivo: ${missing.join(', ')}`
      if (json) {
        const out = {
          version: '1.0.0',
          command: 'create',
          flags: { json, nonInteractive, yes, verbose },
          environment: { tty, node: process.version, platform: process.platform },
          status: 'error',
          error: { message, code: 'EINVAL' },
        }
        process.stdout.write(JSON.stringify(out) + '\n')
      } else {
        const msg = colorOn ? chalk.red(message) : message
        console.error(msg)
      }
      process.exit(1)
    }
    answers = {
      projectName: input.projectName,
      starterKit: input.starterKit,
      db: input.db,
      dbConn: {
        host: input.dbHost,
        port: input.dbPort,
        name: input.dbName,
        user: input.dbUser,
        password: input.dbPassword,
      },
      filament: { name: input.filamentName, email: input.filamentEmail, password: input.filamentPassword },
      herdDir: input.herdDir || (await getHerdDirectory()),
    }
  }

  const starterKitFlag = `--${answers.starterKit}`
  const dbLabel = dbLabelOf(answers.db)
  const events = []
  const startedAt = Date.now()

  let projectPath = ''
  const renderer = json ? 'silent' : interactive ? 'default' : 'silent'

  const tasks = new Listr(
    [
      {
        title: 'Prechequeos',
        task: async task => {
          // herd
          try {
            await commandExists('herd')
            if (!json && colorOn) task.output = chalk.green('herd OK')
          } catch {
            throw new Error('Laravel Herd no parece estar instalado. Instálalo antes de continuar.')
          }

          // cambiar a Herd dir
          const herdDirectory = await getHerdDirectory(answers.herdDir)
          process.chdir(herdDirectory)

          // registrar
          events.push({ name: 'prechecks', status: 'success' })
        },
      },
      {
        title: 'Scaffold del proyecto',
        task: async () => {
          // laravel installer
          let hasLaravel = true
          try {
            await commandExists('laravel')
          } catch {
            hasLaravel = false
          }
          if (!hasLaravel) {
            const r = await run('composer global require laravel/installer -q -n')
            events.push({ name: 'install_laravel_installer', ...r })
            if (r.status === 'error') throw new Error('Fallo al instalar Laravel Installer')
          }

          // crear proyecto
          const createCmd = `laravel new ${answers.projectName} ${starterKitFlag} --git --pest --no-interaction`
          const r2 = await run(createCmd)
          events.push({ name: 'laravel_new', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo al crear el proyecto Laravel')

          projectPath = path.join(process.cwd(), answers.projectName)
          process.chdir(projectPath)
          events.push({ name: 'chdir_project', status: 'success' })
        },
      },
      {
        title: 'Base de datos y entorno',
        task: async () => {
          // Advertencia si MySQL/PostgreSQL no está escuchando
          if (answers.db === 'mysql' || answers.db === 'postgresql') {
            const listening =
              answers.db === 'mysql'
                ? await detectMysqlService(answers.dbConn.host, answers.dbConn.port)
                : await detectPostgresService(answers.dbConn.host, answers.dbConn.port)
            const msg = listening
              ? `${answers.db === 'mysql' ? 'MySQL' : 'PostgreSQL'} detectado en ${answers.dbConn.host}:${
                  answers.dbConn.port
                }`
              : `Advertencia: No se detectó ${answers.db === 'mysql' ? 'MySQL' : 'PostgreSQL'} activo en ${
                  answers.dbConn.host
                }:${answers.dbConn.port}. Inícialo para evitar fallos en migraciones.`
            if (!json) {
              const out = colorOn ? (listening ? chalk.green(msg) : chalk.yellow.bold(msg)) : msg
              console.log(out)
            }
            events.push({
              name: answers.db === 'mysql' ? 'mysql_service_check' : 'postgres_service_check',
              status: listening ? 'success' : 'warning',
              stdout: msg,
            })
          }
          if (answers.db === 'supabase') {
            // node/npm
            try {
              await commandExists('node')
            } catch {
              throw new Error('Node.js no está instalado. Requerido para Supabase.')
            }
            try {
              await commandExists('npm')
            } catch {
              throw new Error('npm no está instalado. Requerido para Supabase.')
            }

            // instalar supabase cli en el proyecto
            const r0 = await run('npm install supabase --save-dev')
            events.push({ name: 'npm_install_supabase_cli', ...r0 })
            if (r0.status === 'error') throw new Error('Fallo al instalar Supabase CLI')

            // docker running
            const r1 = await run('docker info')
            events.push({ name: 'docker_info', ...r1 })
            if (r1.status === 'error') throw new Error('Docker no está en ejecución. Inícialo antes de continuar.')

            // supabase init
            const r2 = await run('npx supabase init --yes')
            events.push({ name: 'supabase_init', ...r2 })
            if (r2.status === 'error') throw new Error('Fallo al inicializar Supabase')

            // supabase start
            const r3 = await run('npx supabase start')
            events.push({ name: 'supabase_start', ...r3 })
            if (r3.status === 'error') throw new Error('Fallo al iniciar Supabase')
          }

          // Configurar .env según DB
          if (answers.db === 'sqlite') {
            await updateEnvValues(projectPath, { DB_CONNECTION: 'sqlite' })
            await maybeCreateSqliteDatabase(projectPath)
          } else if (answers.db === 'supabase') {
            await updateEnvValues(projectPath, {
              DB_CONNECTION: 'pgsql',
              DB_HOST: 'localhost',
              DB_PORT: '54322',
              DB_DATABASE: 'postgres',
              DB_USERNAME: 'postgres',
              DB_PASSWORD: 'postgres',
            })
          } else if (answers.db === 'mysql' || answers.db === 'postgresql') {
            await updateEnvValues(projectPath, {
              DB_CONNECTION: answers.db === 'mysql' ? 'mysql' : 'pgsql',
              DB_HOST: answers.dbConn.host,
              DB_PORT: answers.dbConn.port,
              DB_DATABASE: answers.dbConn.name,
              DB_USERNAME: answers.dbConn.user,
              DB_PASSWORD: answers.dbConn.password,
            })
          }

          // App locale
          await setAppLocaleEs(projectPath)

          // Migraciones
          const r4 = await run('php artisan migrate -n')
          events.push({ name: 'artisan_migrate', ...r4 })
          if (r4.status === 'error') throw new Error('Fallo al ejecutar migraciones')
        },
      },
      {
        title: 'Parche 2FA (UserFactory)',
        task: async () => {
          const has2fa = await detectTwoFactorColumnsInMigrations(projectPath)
          events.push({
            name: 'detect_two_factor_migration',
            status: has2fa ? 'success' : 'skipped',
            stdout: has2fa ? '2FA columns detected' : 'No 2FA columns detected',
          })
          if (!has2fa) return
          const patch = await patchUserFactoryTwoFactorDefaults(projectPath)
          events.push({
            name: 'patch_user_factory_2fa',
            status: patch.patched ? 'success' : 'skipped',
            stdout: patch.patched ? 'UserFactory patched' : `Skipped (${patch.reason})`,
          })
        },
      },
      {
        title: 'Filament',
        task: async () => {
          const r1 = await run('composer require filament/filament --with-all-dependencies -q -n')
          events.push({ name: 'composer_filament', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo instalando Filament')

          const r2 = await run('php artisan filament:install --panels -n -q')
          events.push({ name: 'artisan_filament_install', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo configurando Filament')

          const r3 = await run(
            `php artisan make:filament-user --name="${answers.filament.name}" --email="${answers.filament.email}" --password="${answers.filament.password}"`,
          )
          events.push({ name: 'artisan_filament_user', ...r3 })
          if (r3.status === 'error') throw new Error('Fallo creando usuario de Filament')

          const r4 = await run('php artisan make:filament-resource User --generate -n -q')
          events.push({ name: 'artisan_filament_resource_user', ...r4 })
          if (r4.status === 'error') throw new Error('Fallo creando Resource User')
        },
      },
      {
        title: 'Pruebas (Pest)',
        task: async () => {
          const r = await run(
            'php artisan pest:install -n -q || composer exec -q pest -- --init || vendor/bin/pest --init',
          )
          events.push({ name: 'pest_install', ...r })
          if (r.status === 'error') throw new Error('Fallo configurando Pest')
        },
      },
      {
        title: 'Herramientas de desarrollo',
        task: async () => {
          const r1 = await run('composer require laravel/boost --dev -q -n')
          events.push({ name: 'composer_laravel_boost', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo instalando Laravel Boost')

          const r2 = await run('php artisan boost:install -q -n')
          events.push({ name: 'artisan_boost_install', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo configurando Laravel Boost')

          const r3 = await run('composer require "larastan/larastan:^3.0" --dev -q')
          events.push({ name: 'composer_larastan', ...r3 })
          if (r3.status === 'error') throw new Error('Fallo instalando Larastan')

          await createPhpstanFile(projectPath)

          const r4 = await run('composer require barryvdh/laravel-debugbar --dev -q')
          events.push({ name: 'composer_debugbar', ...r4 })
          if (r4.status === 'error') throw new Error('Fallo instalando Debugbar')

          const r5 = await run('composer require laravel-lang/common -q')
          events.push({ name: 'composer_laravel_lang', ...r5 })
          if (r5.status === 'error') throw new Error('Fallo instalando Laravel Lang')
        },
      },
      {
        title: 'Calidad de código',
        task: async () => {
          const r1 = await run('composer require laravel/pint --dev -q')
          events.push({ name: 'composer_pint', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo instalando Pint')

          await createPintFile(projectPath)

          const r2 = await run('composer require rector/rector --dev -q')
          events.push({ name: 'composer_rector', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo instalando Rector')

          await createRectorFile(projectPath)
        },
      },
      {
        title: 'Essentials',
        task: async () => {
          const r1 = await run(
            'composer config repositories.essentials-fork vcs https://github.com/JhonMA82/essentials',
          )
          events.push({ name: 'composer_config_essentials_repo', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo configurando repo Essentials')

          const r2 = await run('composer require nunomaduro/essentials:0.1.1 -q -n')
          events.push({ name: 'composer_essentials', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo instalando Essentials')

          const r3 = await run('php artisan vendor:publish --tag=essentials-config -n -q')
          events.push({ name: 'artisan_vendor_publish_essentials', ...r3 })
          if (r3.status === 'error') throw new Error('Fallo publicando configuración de Essentials')
        },
      },
      {
        title: 'Frontend (Node + Vite)',
        task: async () => {
          try {
            await commandExists('node')
          } catch {
            throw new Error('Node.js no está instalado.')
          }
          try {
            await commandExists('npm')
          } catch {
            throw new Error('npm no está instalado.')
          }

          const r1 = await run('npm install')
          events.push({ name: 'npm_install', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo en npm install')

          if (answers.starterKit === 'react') {
            const r2 = await run('npm install @vitejs/plugin-react --save-dev')
            events.push({ name: 'npm_install_vite_react', ...r2 })
            if (r2.status === 'error') throw new Error('Fallo instalando plugin Vite React')
          } else if (answers.starterKit === 'vue') {
            const r3 = await run('npm install @vitejs/plugin-vue --save-dev')
            events.push({ name: 'npm_install_vite_vue', ...r3 })
            if (r3.status === 'error') throw new Error('Fallo instalando plugin Vite Vue')
          }

          const r4 = await run('npm run build')
          events.push({ name: 'npm_run_build', ...r4 })
          if (r4.status === 'error') throw new Error('Fallo construyendo assets con Vite')
        },
      },
      {
        title: 'Localización ES',
        task: async () => {
          const r1 = await run('php artisan lang:add es -n -q')
          events.push({ name: 'artisan_lang_add', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo agregando idioma es')

          const r2 = await run('php artisan lang:update -q -n')
          events.push({ name: 'artisan_lang_update', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo actualizando traducciones')
        },
      },
      {
        title: 'Pruebas y calidad (pre-commit)',
        task: async () => {
          await ensurePhpunitAppLocaleEn(projectPath)

          const r1 = await run('php vendor/bin/phpstan')
          events.push({ name: 'phpstan', ...r1 })
          if (r1.status === 'error') throw new Error('PHPStan falló')

          const r2 = await run('php vendor/bin/pest')
          events.push({ name: 'pest', ...r2 })
          if (r2.status === 'error') throw new Error('Pest falló')

          const r3 = await run('php vendor/bin/pint')
          events.push({ name: 'pint', ...r3 })
          if (r3.status === 'error') throw new Error('Pint falló')

          const r4 = await run('php vendor/bin/rector process')
          events.push({ name: 'rector', ...r4 })
          if (r4.status === 'error') throw new Error('Rector falló')
        },
      },
      {
        title: 'Git',
        task: async () => {
          const r1 = await run('git add .')
          events.push({ name: 'git_add', ...r1 })
          if (r1.status === 'error') throw new Error('Fallo en git add')

          const commitMessage = `✨ Filament + ${dbLabel} instalados: Configuración inicial por fases con starter kit y herramientas`
          const r2 = await run(`git commit -m "${commitMessage}"`)
          events.push({ name: 'git_commit', ...r2 })
          if (r2.status === 'error') throw new Error('Fallo en git commit')
        },
      },
    ],
    {
      renderer,
      // En modo no interactivo sin JSON, podríamos usar 'simple', pero 'silent' evita ruido en CI.
      concurrent: false,
      exitOnError: true,
    },
  )

  try {
    await tasks.run()
    const totalMs = Date.now() - startedAt

    if (json) {
      // Si DB supabase, intentar obtener estado (no fatal si falla)
      let supabaseStatus = null
      if (answers.db === 'supabase') {
        const r = await run('npx supabase status')
        supabaseStatus = { status: r.status, stdout: r.stdout, stderr: r.stderr }
      }

      const out = {
        version: '1.0.0',
        command: 'create',
        flags: { json, nonInteractive, yes, verbose },
        environment: { tty, node: process.version, platform: process.platform },
        input: {
          projectName: answers.projectName,
          starterKit: answers.starterKit,
          db: answers.db,
          dbConn: answers.dbConn || null,
          herdDir: answers.herdDir,
          filament: { name: answers.filament.name, email: answers.filament.email },
        },
        tasks: events.map((e, i) => ({
          index: i,
          name: e.name,
          status: e.status,
          durationMs: e.durationMs ?? null,
          stdout: e.stdout ?? null,
          stderr: e.stderr ?? null,
        })),
        result: {
          status: 'success',
          projectPath,
          dbLabel,
          supabase: supabaseStatus,
        },
        metrics: { totalDurationMs: totalMs },
      }
      process.stdout.write(JSON.stringify(out) + '\n')
      process.exit(0)
    } else {
      // Texto
      if (answers.db === 'supabase') {
        const r = await run('npx supabase status')
        if (colorOn) {
          if (r.status === 'success') {
            console.log(chalk.green.bold('\nLos contenedores de Supabase ya están en ejecución.'))
            console.log(chalk.yellow.bold('\nInformación de los contenedores de Supabase:'))
            console.log(chalk.cyan(r.stdout || ''))
          } else {
            console.log(chalk.red('No se pudo obtener la información de los contenedores de Supabase.'))
          }
        } else {
          if (r.status === 'success') {
            console.log('\nSupabase en ejecución.')
            console.log('\nEstado de contenedores:')
            console.log(r.stdout || '')
          } else {
            console.log('No se pudo obtener estado de Supabase.')
          }
        }
      }

      const done = colorOn
        ? chalk.bold('\n¡Que disfrutes tu nuevo proyecto! 🚀')
        : '\n¡Que disfrutes tu nuevo proyecto! 🚀'
      console.log(done)

      // Mostrar menú de opciones al finalizar el proceso
      const option = await showFinalMenu(projectPath, colorOn)

      if (option === 'vscode') {
        const result = await openVSCode(projectPath)
        if (!result.success) {
          const errorMsg = colorOn
            ? chalk.red.bold(`\nError al abrir VS Code: ${result.error}`)
            : `\nError al abrir VS Code: ${result.error}`
          console.error(errorMsg)
        }
      }
      // Si la opción es 'exit' o cualquier otra, simplemente terminamos

      process.exit(0)
    }
  } catch (err) {
    const totalMs = Date.now() - startedAt
    if (json) {
      const out = {
        version: '1.0.0',
        command: 'create',
        flags: { json, nonInteractive, yes, verbose },
        environment: { tty, node: process.version, platform: process.platform },
        status: 'error',
        tasks: events.map((e, i) => ({
          index: i,
          name: e.name,
          status: e.status,
          durationMs: e.durationMs ?? null,
          stdout: e.stdout ?? null,
          stderr: e.stderr ?? null,
        })),
        error: { message: err.message, step: err.step || null },
        metrics: { totalDurationMs: totalMs },
      }
      process.stdout.write(JSON.stringify(out) + '\n')
    } else {
      const msg = colorOn
        ? chalk.red.bold(`\nHa ocurrido un error: ${err.message}`)
        : `\nHa ocurrido un error: ${err.message}`
      console.error(msg)
    }
    process.exit(1)
  }
}
