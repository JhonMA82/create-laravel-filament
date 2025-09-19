import { Command, Option } from 'commander'
import process from 'process'
import { runCreate } from '../commands/create.js'

function isTTY() {
  return !!process.stdout.isTTY
}

export function buildProgram() {
  const program = new Command()

  program
    .name('create-laravel-filament')
    .description('Crea y configura un proyecto Laravel + Filament con opciones guiadas o banderas.')
    .version('1.0.0')

  // Flags globales
  program
    .option('--json', 'Salida JSON estructurada')
    .option('--no-color', 'Desactiva colores')
    .option('--color', 'Intenta forzar colores')
    .option('-y, --yes', 'Asume valores por defecto en prompts')
    .option('--non-interactive', 'Desactiva prompts; requiere banderas completas')
    .option('--verbose', 'Salida detallada')
  // Ayuda global y ejemplos
  program.helpOption('-h, --help', 'Muestra ayuda')
  program.showHelpAfterError('(usa --help para ver las opciones disponibles)')
  program.addHelpText(
    'after',
    `
Ejemplos:
  # Interactivo (prompts con Clack)
  $ create-laravel-filament

  # No interactivo con banderas completas
  $ create-laravel-filament create --non-interactive \\
      --project-name app --starter-kit react --db sqlite -y

  # No interactivo para MySQL
  $ create-laravel-filament create --non-interactive --db mysql \\
      --project-name app --starter-kit vue \\
      --db-host 127.0.0.1 --db-port 3306 --db-name laravel --db-user root --db-password secret \\
      --filament-name Admin --filament-email admin@admin.com --filament-password password

  # Salida JSON (para CI), sin colores ni prompts
  $ create-laravel-filament create --json --non-interactive \\
      --project-name app --starter-kit livewire --db sqlite
`,
  )

  // Comando create (por defecto)
  const create = program.command('create', { isDefault: true }).description('Crea un nuevo proyecto Laravel + Filament')

  create
    .addOption(new Option('--project-name <name>', 'Nombre del proyecto'))
    .addOption(new Option('--starter-kit <kit>', 'Starter kit').choices(['react', 'vue', 'livewire']))
    .addOption(new Option('--db <driver>', 'Base de datos').choices(['sqlite', 'supabase', 'mysql', 'postgresql']))
    .option('--db-host <host>', 'Host de la base de datos')
    .option('--db-port <port>', 'Puerto de la base de datos')
    .option('--db-name <name>', 'Nombre de la base de datos')
    .option('--db-user <user>', 'Usuario de la base de datos')
    .option('--db-password <password>', 'Contraseña de la base de datos')
    .option('--herd-dir <path>', 'Directorio de trabajo de Herd')
    .option('--filament-name <name>', 'Nombre de usuario de Filament')
    .option('--filament-email <email>', 'Correo de Filament')
    .option('--filament-password <password>', 'Contraseña de Filament')
    .action(async opts => {
      const globals = program.opts()
      const ctx = {
        ...globals,
        ...opts,
        env: {
          tty: isTTY(),
          node: process.version,
          platform: process.platform,
        },
      }
      await runCreate(ctx)
    })

  return program
}

export async function runCli(argv = process.argv) {
  const program = buildProgram()
  await program.parseAsync(argv)
}
