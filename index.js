#!/usr/bin/env node

import chalk from 'chalk'
import { runCli } from './src/cli/program.js'

async function main() {
  await runCli(process.argv)
}

main().catch(err => {
  try {
    console.error(chalk.red.bold('\nError fatal en CLI:'), err)
  } catch {
    console.error('\nError fatal en CLI:', err)
  }
  process.exit(1)
})

process.on('SIGINT', () => {
  try {
    console.error(chalk.red.bold('\nOperación cancelada por el usuario.'))
  } catch {
    console.error('\nOperación cancelada por el usuario.')
  }
  process.exit(130)
})
