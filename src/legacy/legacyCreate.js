import chalk from 'chalk'
import inquirer from 'inquirer'
import path from 'path'
import { chdir } from 'process'
import {
  askFilamentCredentials,
  checkCommandExists,
  checkDocker,
  configureDatabase,
  createPhpstanFile,
  createPintFile,
  createRectorFile,
  divider,
  ensurePhpunitAppLocaleEn,
  getHerdDirectory,
  initSupabase,
  installSupabaseCli,
  printPanel,
  runCommand,
  setAppLocaleEs,
  showSummaryTable,
  startSupabase,
} from './utils.js'

export const runLegacyCreate = async () => {
  // Clear console
  console.log('\x1Bc')
  printPanel('Asistente de Instalación de Proyectos Laravel + Filament', 'Bienvenido', 'magenta')

  const totalSteps = 12

  // --- Step 1: Pre-checks and parameters ---
  divider(`Paso 1/${totalSteps} · Prechequeos y parámetros`)

  if (!(await checkCommandExists('herd'))) {
    console.log(chalk.red.bold('❌ Laravel Herd no parece estar instalado. Por favor, instálalo antes de continuar.'))
    process.exit(1)
  }
  console.log(chalk.green('✅ Laravel Herd detectado.'))

  const herdDirectory = await getHerdDirectory()
  try {
    chdir(herdDirectory)
    console.log(`📁 Usando el directorio: ${chalk.cyan(herdDirectory)}`)
  } catch (err) {
    console.log(chalk.red.bold(`❌ No se pudo cambiar al directorio de Herd: ${herdDirectory}`))
    process.exit(1)
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: chalk.yellow.bold('Introduce el nombre de tu proyecto Laravel'),
      validate: input => (input ? true : 'El nombre del proyecto no puede estar vacío.'),
    },
    {
      type: 'list',
      name: 'starterKitChoice',
      message: chalk.yellow.bold('Selecciona el starter kit'),
      choices: ['react', 'vue', 'livewire'],
      default: 'react',
    },
    {
      type: 'list',
      name: 'dbChoice',
      message: chalk.yellow.bold('Selecciona la base de datos'),
      choices: ['sqlite', 'supabase', 'mysql', 'postgresql'],
      default: 'sqlite',
    },
  ])

  const { projectName, starterKitChoice, dbChoice } = answers
  const starterKitFlag = `--${starterKitChoice}`

  const filamentCredentials = await askFilamentCredentials()

  showSummaryTable(projectName, starterKitChoice, dbChoice, herdDirectory, filamentCredentials)

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: '¿Deseas continuar con estos parámetros?',
      default: true,
    },
  ])

  if (!proceed) {
    console.log(chalk.red.bold('Instalación cancelada por el usuario.'))
    process.exit(0)
  }

  // --- Step 2: Scaffold Laravel + Pest ---
  divider(`Paso 2/${totalSteps} · Scaffold del proyecto`)

  if (!(await checkCommandExists('laravel'))) {
    await runCommand('composer global require laravel/installer -q -n', 'Instalando Laravel Installer')
  } else {
    console.log(chalk.green('✅ Laravel Installer ya está instalado.'))
  }

  await runCommand(
    `laravel new ${projectName} ${starterKitFlag} --git --pest --no-interaction`,
    `Creando proyecto Laravel '${projectName}'`,
  )

  const projectPath = path.join(herdDirectory, projectName)
  chdir(projectPath)
  console.log(`➡️  Cambiando al directorio ${chalk.cyan(projectPath)}`)

  // --- Step 3: Database and environment ---
  divider(`Paso 3/${totalSteps} · Base de datos y entorno`)

  if (dbChoice === 'supabase') {
    if (!(await checkCommandExists('node')) || !(await checkCommandExists('npm'))) {
      console.log(
        chalk.red.bold('❌ Node.js y/o npm no están instalados. Por favor, instálalos para continuar con Supabase.'),
      )
      process.exit(1)
    }
    await installSupabaseCli()
    await initSupabase(projectPath)
    await checkDocker()
    await startSupabase()
  }

  const dbLabel = await configureDatabase(projectPath, dbChoice)
  await setAppLocaleEs(projectPath)

  await runCommand('php artisan migrate -n', 'Ejecutando migraciones de Laravel')

  // --- Step 4: Filament ---
  divider(`Paso 4/${totalSteps} · Filament`)
  await runCommand('composer require filament/filament --with-all-dependencies -q -n', 'Instalando Filament PHP')
  await runCommand('php artisan filament:install --panels -n -q', 'Configurando paneles de Filament')
  await runCommand(
    `php artisan make:filament-user --name="${filamentCredentials.name}" --email="${filamentCredentials.email}" --password="${filamentCredentials.password}"`,
    'Creando usuario de Filament',
  )
  await runCommand('php artisan make:filament-resource User --generate -n -q', 'Creando Resource para el modelo User')

  // --- Step 5: Testing (Pest) ---
  divider(`Paso 5/${totalSteps} · Pruebas (Pest)`)
  await runCommand(
    'php artisan pest:install -n -q || composer exec -q pest -- --init || vendor/bin/pest --init',
    'Configurando Pest',
  )

  // --- Step 6: Dev tools ---
  divider(`Paso 6/${totalSteps} · Herramientas de desarrollo`)
  printPanel('Laravel Boost acelera el desarrollo asistido por IA...', 'Instalando Laravel Boost', 'blue')
  await runCommand('composer require laravel/boost --dev -q -n', 'Instalando Laravel Boost')
  await runCommand('php artisan boost:install -q -n', 'Configurando Laravel Boost')

  await runCommand('composer require "larastan/larastan:^3.0" --dev -q', 'Instalando Larastan')
  await createPhpstanFile(projectPath)
  await runCommand('composer require barryvdh/laravel-debugbar --dev -q', 'Instalando Laravel Debugbar')
  await runCommand('composer require laravel-lang/common -q', 'Instalando Laravel Lang')

  // --- Step 7: Code Quality ---
  divider(`Paso 7/${totalSteps} · Calidad de código`)
  await runCommand('composer require laravel/pint --dev -q', 'Instalando Laravel Pint')
  await createPintFile(projectPath)
  await runCommand('composer require rector/rector --dev -q', 'Instalando Rector')
  await createRectorFile(projectPath)

  // --- Step 8: Essentials ---
  divider(`Paso 8/${totalSteps} · Essentials`)
  await runCommand(
    'composer config repositories.essentials-fork vcs https://github.com/JhonMA82/essentials',
    'Configurando repositorio de Essentials',
  )
  await runCommand('composer require nunomaduro/essentials:0.1.1 -q -n', 'Instalando Essentials')
  await runCommand('php artisan vendor:publish --tag=essentials-config -n -q', 'Publicando configuración de Essentials')

  // --- Step 9: Frontend (Node + Vite) ---
  divider(`Paso 9/${totalSteps} · Frontend (Node + Vite)`)
  if (!(await checkCommandExists('node')) || !(await checkCommandExists('npm'))) {
    console.log(chalk.red.bold('❌ Node.js y/o npm no están instalados. Por favor, instálalos para continuar.'))
    process.exit(1)
  }
  await runCommand('npm install', 'Instalando dependencias de Node.js (npm install)')
  if (starterKitChoice === 'react') {
    await runCommand('npm install @vitejs/plugin-react --save-dev', 'Instalando plugin de Vite para React')
  } else if (starterKitChoice === 'vue') {
    await runCommand('npm install @vitejs/plugin-vue --save-dev', 'Instalando plugin de Vite para Vue')
  }
  await runCommand('npm run build', 'Compilando assets con Vite (npm run build)')

  // --- Step 10: Localization ES ---
  divider(`Paso 10/${totalSteps} · Localización ES`)
  await runCommand('php artisan lang:add es -n -q', 'Agregando idioma español')
  await runCommand('php artisan lang:update -q -n', 'Actualizando traducciones')

  // --- Step 11: Pre-commit checks ---
  divider(`Paso 11/${totalSteps} · Pruebas y calidad (pre-commit)`)
  await ensurePhpunitAppLocaleEn(projectPath)
  await runCommand('php vendor/bin/phpstan', 'Ejecutando PHPStan (análisis estático)')
  await runCommand('php vendor/bin/pest', 'Ejecutando Pest (tests)')
  await runCommand('php vendor/bin/pint', 'Ejecutando Pint (formateo)')
  await runCommand('php vendor/bin/rector process', 'Ejecutando Rector (refactor)')

  // --- Step 12: Git ---
  divider(`Paso 12/${totalSteps} · Git`)
  await runCommand('git add .', 'Añadiendo archivos a Git (git add)')
  const commitMessage = `✨ Filament + ${dbLabel} instalados: Configuración inicial por fases con starter kit y herramientas`
  await runCommand(`git commit -m "${commitMessage}"`, 'Creando commit inicial')

  // --- Finalization ---
  printPanel('¡Instalación Completada!', 'Éxito', 'green')

  if (dbChoice === 'supabase') {
    console.log(chalk.green.bold('\nLos contenedores de Supabase ya están en ejecución.'))
    console.log(chalk.yellow.bold('\nInformación de los contenedores de Supabase:'))
    try {
      const { stdout } = await runCommand('npx supabase status', 'Obteniendo estado de Supabase', false)
      console.log(chalk.cyan(stdout))
    } catch (error) {
      console.log(chalk.red('No se pudo obtener la información de los contenedores de Supabase.'))
    }
  }

  showSummaryTable(projectName, starterKitChoice, dbChoice, herdDirectory, filamentCredentials, 'Resumen final')
  console.log(chalk.bold('\n¡Que disfrutes tu nuevo proyecto! 🚀'))
}

process.on('SIGINT', () => {
  console.log(chalk.red.bold('\nInstalación cancelada por el usuario.'))
  process.exit(0)
})
