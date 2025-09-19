import boxen from 'boxen'
import chalk from 'chalk'
import Table from 'cli-table3'
import commandExists from 'command-exists'
import { execa } from 'execa'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'
import net from 'net'
import ora from 'ora'
import os from 'os'
import path from 'path'

// --- Default Filament Values ---
const DEFAULT_FILAMENT_NAME = 'Admin'
const DEFAULT_FILAMENT_EMAIL = 'admin@admin.com'
const DEFAULT_FILAMENT_PASSWORD = 'password'

// --- UI Helper Functions ---

/**
 * Muestra un panel con un título y texto.
 * @param {string} text The text to display.
 * @param {string} title The title of the panel.
 * @param {string} color The color of the border.
 */
export function printPanel(text, title, color = 'blue') {
  const boxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: color,
    title: chalk.bold[color](title),
    titleAlignment: 'center',
    textAlignment: 'center',
  }
  console.log(boxen(text, boxenOptions))
}

/**
 * Pinta un separador con título.
 * @param {string} title The title of the divider.
 * @param {string} color The color of the divider.
 */
export function divider(title, color = 'magenta') {
  const fullWidth = process.stdout.columns || 80
  const titleLength = title.length
  const lineLength = Math.floor((fullWidth - titleLength - 2) / 2)
  const line = '─'.repeat(lineLength)
  console.log(chalk[color].bold(`\n${line} ${title} ${line}`))
}

/**
 * Enmascara valores sensibles.
 * @param {string} value The string to mask.
 * @returns {string} The masked string.
 */
const mask = value => (value ? '*'.repeat(value.length) : '')

// --- System and Execution Functions ---

/**
 * Executes an external command and shows a spinner.
 * @param {string} command The command to execute.
 * @param {string} message The message to display on the spinner.
 * @param {boolean} showSpinner Whether to show the spinner.
 * @returns {Promise<import('execa').ExecaReturnValue>}
 */
export async function runCommand(command, message, showSpinner = true) {
  const spinner = ora(`${chalk.green.bold(message)}...`).start()
  try {
    const result = await execa(command, { shell: true })
    if (showSpinner) {
      spinner.succeed(chalk.green.bold(`${message} ${chalk.dim('(OK)')}`))
    } else {
      spinner.stop()
    }
    return result
  } catch (error) {
    spinner.fail(chalk.red.bold(`Error durante: '${message}'`))
    console.error(chalk.red(`Comando: ${command}`))
    console.error(chalk.red(`Error estándar: ${error.stderr}`))
    if (error.stdout) {
      console.error(chalk.red(`Salida estándar: ${error.stdout}`))
    }
    process.exit(1)
  }
}

/**
 * Checks if a command exists on the system.
 * @param {string} command The command to check.
 * @returns {Promise<boolean>}
 */
export async function checkCommandExists(command) {
  try {
    await commandExists(command)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Gets or creates the Herd directory in the user's home folder.
 * @returns {Promise<string>} Path to the Herd directory.
 */
export async function getHerdDirectory() {
  const herdDir = path.join(os.homedir(), 'Herd')
  try {
    await fs.access(herdDir)
  } catch (error) {
    console.log(`El directorio ${chalk.yellow(herdDir)} no existe. Creándolo...`)
    await fs.mkdir(herdDir, { recursive: true })
  }
  return herdDir
}

/**
 * Checks if Docker is installed and running.
 */
export async function checkDocker() {
  if (!(await checkCommandExists('docker'))) {
    console.log(chalk.red.bold('❌ Docker no está instalado. Por favor, instálalo antes de continuar.'))
    process.exit(1)
  }
  try {
    await execa('docker info', { shell: true })
    console.log(chalk.green('✅ Docker está instalado y en ejecución.'))
  } catch (error) {
    console.log(
      chalk.red.bold('❌ Docker está instalado pero no está en ejecución. Por favor, inícialo antes de continuar.'),
    )
    process.exit(1)
  }
}

/**
 * Verifica si un servicio está escuchando en host:puerto (TCP).
 */
function isPortOpen(host, port, timeout = 1200) {
  return new Promise(resolve => {
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

// --- File Tools ---
/**
 * Creates a file with the given content.
 * @param {string} filePath The full path to the file.
 * @param {string} content The content to write to the file.
 * @param {string} fileName The name of the file for logging.
 */
async function createFile(filePath, content, fileName) {
  try {
    await fs.writeFile(filePath, content)
    console.log(chalk.green.bold(`✅ Archivo ${fileName} creado en ${filePath}`))
    return true
  } catch (error) {
    console.log(chalk.red.bold(`❌ Error al crear el archivo ${fileName}: ${error.message}`))
    return false
  }
}

export function createRectorFile(projectPath) {
  const rectorContent = `<?php

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
  return createFile(path.join(projectPath, 'rector.php'), rectorContent, 'rector.php')
}

export function createPhpstanFile(projectPath) {
  const phpstanContent = `includes:
    - vendor/larastan/larastan/extension.neon
parameters:
    paths:
        - app/
    level: 5`
  return createFile(path.join(projectPath, 'phpstan.neon'), phpstanContent, 'phpstan.neon')
}

export function createPintFile(projectPath) {
  const pintContent = `{
    "preset": "laravel"
}`
  return createFile(path.join(projectPath, 'pint.json'), pintContent, 'pint.json')
}

// --- .env and Database ---

/**
 * Updates keys in the .env file, adding those that don't exist.
 * @param {string} projectPath The path to the project.
 * @param {Object<string, string>} updates The key-value pairs to update.
 */
async function updateEnvValues(projectPath, updates) {
  const envPath = path.join(projectPath, '.env')
  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf8')
  } catch (error) {
    console.log(chalk.red.bold('❌ No se encontró el archivo .env. Omitiendo actualización.'))
    return
  }

  let lines = content.split('\n')
  const keysFound = new Set()

  lines = lines.map(line => {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('#') || !trimmedLine.includes('=')) {
      return line
    }
    const key = trimmedLine.split('=')[0]
    if (updates[key] !== undefined) {
      keysFound.add(key)
      return `${key}=${updates[key]}`
    }
    return line
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!keysFound.has(key)) {
      lines.push(`${key}=${value}`)
    }
  }

  await fs.writeFile(envPath, lines.join('\n'))
  console.log(chalk.green.bold('✅ Archivo .env actualizado'))
}

export async function setAppLocaleEs(projectPath) {
  return updateEnvValues(projectPath, { APP_LOCALE: 'es' })
}

export async function ensurePhpunitAppLocaleEn(projectPath) {
  const phpunitCandidates = [path.join(projectPath, 'phpunit.xml'), path.join(projectPath, 'phpunit.xml.dist')]
  let phpunitPath = null
  for (const p of phpunitCandidates) {
    try {
      await fs.access(p)
      phpunitPath = p
      break
    } catch (e) {
      /* File doesn't exist, continue */
    }
  }

  if (!phpunitPath) {
    console.log(chalk.yellow.bold('⚠️ No se encontró phpunit.xml ni phpunit.xml.dist. Omitiendo actualización.'))
    return
  }

  try {
    let xmlData = await fs.readFile(phpunitPath, 'utf-8')
    //console.log(chalk.yellow(`[DEBUG] XML original en ${path.basename(phpunitPath)}:\n${xmlData}`))

    // Ensure colors="true"
    xmlData = xmlData.replace(/<phpunit([^>]*)>/i, (match, attrs) => {
      if (!attrs.includes('colors=')) {
        return `<phpunit${attrs} colors="true">`
      }
      return match.replace(/colors\s*=\s*["']?[^"']*["']?/i, 'colors="true"')
    })
    //console.log(chalk.yellow(`[DEBUG] Colors fixed to: true`))

    // Add or update APP_LOCALE=en in <php>
    if (xmlData.includes('name="APP_LOCALE"')) {
      xmlData = xmlData.replace(/<env\s+name="APP_LOCALE"\s+value="[^"]*"/i, 'env name="APP_LOCALE" value="en"')
    } else {
      xmlData = xmlData.replace(/<php>/i, '<php><env name="APP_LOCALE" value="en"/>')
    }

    //console.log(chalk.yellow(`[DEBUG] XML final:\n${xmlData}`))

    await fs.writeFile(phpunitPath, xmlData)
    console.log(chalk.green.bold(`✅ phpunit actualizado en ${path.basename(phpunitPath)} con APP_LOCALE=en`))
  } catch (e) {
    console.log(chalk.red.bold(`❌ No se pudo actualizar phpunit.xml: ${e.message}`))
  }
}

async function maybeCreateSqliteDatabase(projectPath) {
  const dbFile = path.join(projectPath, 'database', 'database.sqlite')
  try {
    await fs.mkdir(path.dirname(dbFile), { recursive: true })
    await fs.writeFile(dbFile, '')
    console.log(chalk.green.bold(`✅ Base de datos SQLite creada en ${dbFile}`))
  } catch (e) {
    console.log(chalk.red.bold(`❌ No se pudo crear la base de datos SQLite: ${e.message}`))
  }
}

export async function configureDatabase(projectPath, dbChoice) {
  switch (dbChoice) {
    case 'sqlite':
      await updateEnvValues(projectPath, { DB_CONNECTION: 'sqlite' })
      await maybeCreateSqliteDatabase(projectPath)
      return 'SQLite'
    case 'supabase':
      await updateEnvValues(projectPath, {
        DB_CONNECTION: 'pgsql',
        DB_HOST: 'localhost',
        DB_PORT: '54322',
        DB_DATABASE: 'postgres',
        DB_USERNAME: 'postgres',
        DB_PASSWORD: 'postgres',
      })
      return 'Supabase (PostgreSQL)'
    case 'mysql':
    case 'postgresql':
      const isMysql = dbChoice === 'mysql'
      printPanel(`Configura parámetros de conexión ${isMysql ? 'MySQL' : 'PostgreSQL'}`, 'blue')

      // Nota previa: detectar servicio en host/puerto por defecto antes de pedir datos
      try {
        const defaultHost = '127.0.0.1'
        const defaultPort = isMysql ? 3306 : 5432
        const detected = await isPortOpen(defaultHost, defaultPort, 1200)
        if (!detected) {
          printPanel(
            chalk.red(
              `No se detectó un servicio ${
                isMysql ? 'MySQL' : 'PostgreSQL'
              } escuchando en ${defaultHost}:${defaultPort}.
Si tu servicio está en otra máquina o puerto, podrás indicarlo en los siguientes campos.
Asegúrate de tener la base de datos en ejecución antes de continuar para evitar fallos en las migraciones.`,
            ),
            'Nota',
            'red',
          )
        }
      } catch {}
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: `   ${chalk.cyan(`${isMysql ? 'MySQL' : 'PostgreSQL'} host`)}`,
          default: '127.0.0.1',
        },
        {
          type: 'input',
          name: 'port',
          message: `   ${chalk.cyan(`${isMysql ? 'MySQL' : 'PostgreSQL'} port`)}`,
          default: isMysql ? '3306' : '5432',
        },
        {
          type: 'input',
          name: 'database',
          message: `   ${chalk.cyan(`${isMysql ? 'MySQL' : 'PostgreSQL'} database`)}`,
          default: 'laravel',
        },
        {
          type: 'input',
          name: 'username',
          message: `   ${chalk.cyan(`${isMysql ? 'MySQL' : 'PostgreSQL'} username`)}`,
          default: isMysql ? 'root' : 'postgres',
        },
        {
          type: 'password',
          name: 'password',
          message: `   ${chalk.cyan(`${isMysql ? 'MySQL' : 'PostgreSQL'} password`)}`,
          mask: '*',
        },
      ])
      // Nota: servicio no detectado con los datos ingresados
      {
        const listening = await isPortOpen(answers.host, Number(answers.port) || (isMysql ? 3306 : 5432), 1200)
        if (!listening) {
          printPanel(
            chalk.red(
              `No se detectó un servicio ${isMysql ? 'MySQL' : 'PostgreSQL'} activo en ${answers.host}:${answers.port}.
Inícialo antes de continuar o las migraciones podrían fallar.`,
            ),
            'Nota',
            'red',
          )
        }
      }
      await updateEnvValues(projectPath, {
        DB_CONNECTION: isMysql ? 'mysql' : 'pgsql',
        DB_HOST: answers.host,
        DB_PORT: answers.port,
        DB_DATABASE: answers.database,
        DB_USERNAME: answers.username,
        DB_PASSWORD: answers.password,
      })
      return isMysql ? 'MySQL' : 'PostgreSQL'
  }
}

export async function installSupabaseCli() {
  if (await checkCommandExists('supabase')) {
    console.log(chalk.green('✅ Supabase CLI ya está instalado.'))
    return
  }
  await runCommand('npm install supabase --save-dev', 'Instalando Supabase CLI')
}

export async function initSupabase(projectPath) {
  const supabaseDir = path.join(projectPath, 'supabase')
  try {
    await fs.access(supabaseDir)
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: chalk.yellow('Ya existe una configuración de Supabase. ¿Deseas sobrescribirla?'),
        default: false,
      },
    ])
    if (overwrite) {
      await fs.rm(supabaseDir, { recursive: true, force: true })
    } else {
      console.log(chalk.green('Conservando la configuración existente de Supabase.'))
      return
    }
  } catch (e) {
    /* Directory doesn't exist, continue */
  }
  await runCommand('npx supabase init --yes', 'Inicializando Supabase en el proyecto')
}

export async function startSupabase() {
  await runCommand('npx supabase start', 'Iniciando contenedores de Supabase')
}

// --- Interaction ---

export async function askFilamentCredentials() {
  printPanel('Puedes usar las credenciales por defecto o personalizarlas.', 'Credenciales de Filament', 'blue')
  const { useDefaults } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useDefaults',
      message: '¿Usar valores por defecto? (Admin / admin@admin.com / password)',
      default: true,
    },
  ])

  if (useDefaults) {
    return {
      name: DEFAULT_FILAMENT_NAME,
      email: DEFAULT_FILAMENT_EMAIL,
      password: DEFAULT_FILAMENT_PASSWORD,
      defaultsUsed: true,
    }
  }

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: `   ${chalk.cyan('Nombre de usuario')}`,
      validate: i => (i ? true : 'El nombre no puede estar vacío.'),
    },
    {
      type: 'input',
      name: 'email',
      message: `   ${chalk.cyan('Correo electrónico')}`,
      validate: i => (i.includes('@') && i.includes('.') ? true : 'Formato de correo inválido.'),
    },
    {
      type: 'password',
      name: 'password',
      message: `   ${chalk.cyan('Contraseña')}`,
      mask: '*',
      validate: i => (i.length >= 8 ? true : 'La contraseña debe tener al menos 8 caracteres.'),
    },
  ])
  credentials.defaultsUsed = false
  return credentials
}

export function showSummaryTable(
  projectName,
  starterKit,
  db,
  herdDir,
  filamentCreds,
  title = 'Resumen de configuración',
) {
  const projectPath = path.join(herdDir, projectName)
  const table = new Table({
    head: [chalk.cyan.bold('Clave'), chalk.cyan.bold('Valor')],
    style: { 'padding-left': 1, 'padding-right': 1, head: ['cyan', 'bold'] },
  })

  table.push(
    ['Proyecto', projectName],
    ['Ruta', projectPath],
    ['Starter kit', starterKit.charAt(0).toUpperCase() + starterKit.slice(1)],
    ['Base de datos', db.charAt(0).toUpperCase() + db.slice(1)],
    ['Filament por defecto', filamentCreds.defaultsUsed ? 'Sí' : 'No'],
    ['Usuario Filament', filamentCreds.name],
    ['Correo Filament', filamentCreds.email],
    ['Contraseña Filament', mask(filamentCreds.password)],
  )

  console.log(chalk.cyan.bold(`\n--- ${title} ---`))
  console.log(table.toString())
  console.log('')
}
