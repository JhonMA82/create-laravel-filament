#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Release Management Command for Claude Code
 *
 * This command provides a comprehensive interface for managing the automated release workflow
 * using Conventional Commits, release-please, and GitHub Actions.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ReleaseCommand {
  constructor() {
    this.projectRoot = process.cwd();
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      const packageJson = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'));
      const releasePleaseConfig = existsSync(join(this.projectRoot, '.github', 'release-please-config.json'))
        ? JSON.parse(readFileSync(join(this.projectRoot, '.github', 'release-please-config.json'), 'utf8'))
        : null;

      return {
        packageName: packageJson.name,
        currentVersion: packageJson.version,
        releasePlease: releasePleaseConfig
      };
    } catch (error) {
      console.error('Error loading configuration:', error.message);
      process.exit(1);
    }
  }

  async execute(args) {
    const [action, ...restArgs] = args;

    // Check for sync agent actions
    if (action === 'sync') {
      return this.executeSyncAgent(restArgs);
    }

    switch (action) {
      case 'status':
        return this.showStatus(restArgs);
      case 'commit':
        return this.makeCommit(restArgs);
      case 'release':
        return this.makeRelease(restArgs);
      case 'configure':
        return this.showConfiguration();
      case 'verify':
        return this.verifySetup();
      case 'help':
      default:
        return this.showHelp();
    }
  }

  showStatus(args) {
    const verbose = args.includes('--verbose');

    console.log('\n📋 Release Status');
    console.log('================');

    console.log(`📦 Package: ${this.config.packageName}`);
    console.log(`🏷️  Current Version: ${this.config.currentVersion}`);

    // Check if release-please is configured
    if (this.config.releasePlease) {
      console.log('✅ Release-please: Configured');
    } else {
      console.log('❌ Release-please: Not configured');
    }

    // Check GitHub workflows
    const workflows = ['release-please.yml', 'publish-npm.yml'];
    workflows.forEach(workflow => {
      const path = join(this.projectRoot, '.github', 'workflows', workflow);
      if (existsSync(path)) {
        console.log(`✅ ${workflow}: Exists`);
      } else {
        console.log(`❌ ${workflow}: Missing`);
      }
    });

    // Check Husky hooks
    const hooks = ['commit-msg', 'pre-commit'];
    hooks.forEach(hook => {
      const path = join(this.projectRoot, '.husky', hook);
      if (existsSync(path)) {
        console.log(`✅ ${hook}: Configured`);
      } else {
        console.log(`❌ ${hook}: Missing`);
      }
    });

    if (verbose) {
      console.log('\n🔍 Detailed Configuration:');
      console.log(JSON.stringify(this.config, null, 2));
    }

    // Check for uncommitted changes
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        console.log('\n⚠️  Uncommitted changes detected:');
        console.log(status);
      } else {
        console.log('\n✅ No uncommitted changes');
      }
    } catch (error) {
      console.log('\n❌ Unable to check git status');
    }
  }

  analyzeChanges() {
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      const files = status.trim().split('\n').filter(line => line.trim());

      if (files.length === 0 || (files.length === 1 && files[0] === '')) {
        return {
          hasChanges: false,
          changes: [],
          suggestedType: null,
          suggestedVersion: null,
          message: 'No changes detected'
        };
      }

      const changes = files.map(line => {
        const statusCode = line.substring(0, 2);
        const filePath = line.substring(3);
        return { statusCode, filePath };
      });

      const analysis = this.categorizeChanges(changes);
      return {
        hasChanges: true,
        changes,
        ...analysis
      };
    } catch (error) {
      return {
        hasChanges: false,
        changes: [],
        suggestedType: null,
        suggestedVersion: null,
        message: 'Unable to analyze changes'
      };
    }
  }

  categorizeChanges(changes) {
    const categories = {
      feat: [],
      fix: [],
      docs: [],
      style: [],
      refactor: [],
      test: [],
      chore: [],
      ci: []
    };

    changes.forEach(change => {
      const { filePath, statusCode } = change;

      // Ignorar archivos generados o de configuración
      if (filePath.includes('node_modules/') || filePath.includes('.git/') ||
          filePath.includes('dist/') || filePath.includes('build/') ||
          filePath.includes('.log') || filePath.endsWith('.tmp')) {
        return;
      }

      // Categorizar por tipo de archivo y contenido
      if (filePath.includes('test') || filePath.includes('spec') || filePath.includes('__tests__')) {
        categories.test.push(change);
      } else if (filePath.includes('doc') || filePath.includes('readme') || filePath.includes('changelog') || filePath.includes('.md')) {
        categories.docs.push(change);
      } else if (filePath.includes('.github') || filePath.includes('ci') || filePath.includes('workflow')) {
        categories.ci.push(change);
      } else if (filePath.endsWith('.json') || filePath.endsWith('.yaml') || filePath.endsWith('.yml') || filePath.endsWith('.config.js')) {
        if (filePath.includes('package.json') || filePath.includes('husky') || filePath.includes('commitlint')) {
          categories.chore.push(change);
        } else {
          categories.ci.push(change);
        }
      } else if (filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.less') || filePath.includes('style')) {
        categories.style.push(change);
      } else if (filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.jsx') || filePath.endsWith('.tsx')) {
        // Análisis más profundo para archivos de código
        if (statusCode.includes('M') || statusCode.includes('A')) {
          // Por defecto asumimos refactor, pero podríamos analizar el contenido
          categories.refactor.push(change);
        }
      } else {
        categories.chore.push(change);
      }
    });

    // Determinar el tipo dominante y versión sugerida
    const dominantType = this.getDominantType(categories);
    const suggestedVersion = this.getSuggestedVersion(dominantType, categories);

    return {
      categories,
      suggestedType: dominantType,
      suggestedVersion,
      summary: this.generateSummary(categories, dominantType)
    };
  }

  getDominantType(categories) {
    const priorities = ['feat', 'fix', 'refactor', 'test', 'docs', 'style', 'ci', 'chore'];

    for (const type of priorities) {
      if (categories[type].length > 0) {
        return type;
      }
    }

    return 'chore';
  }

  getSuggestedVersion(type, categories) {
    if (type === 'feat') return 'minor';
    if (type === 'fix') return 'patch';
    if (categories.feat.length > 0) return 'minor';
    if (categories.fix.length > 0) return 'patch';
    return 'patch'; // Por defecto patch para otros tipos
  }

  generateSummary(categories, dominantType) {
    const typeNames = {
      feat: 'Nuevas funcionalidades',
      fix: 'Correcciones de errores',
      docs: 'Documentación',
      style: 'Estilos y formato',
      refactor: 'Refactorización',
      test: 'Pruebas',
      chore: 'Tareas de mantenimiento',
      ci: 'CI/CD'
    };

    const summary = [];
    Object.entries(categories).forEach(([type, files]) => {
      if (files.length > 0) {
        summary.push(`${typeNames[type]}: ${files.length} archivos`);
      }
    });

    return {
      type: typeNames[dominantType] || 'Otros',
      details: summary.join(', '),
      dominantType
    };
  }

  getSuggestedMessage(type, categories) {
    const templates = {
      feat: [
        "Añade nueva funcionalidad al sistema",
        "Implementa característica solicitada",
        "Agrega nueva capacidad de usuario",
        "Incorpora nueva funcionalidad principal"
      ],
      fix: [
        "Corrige error en el sistema",
        "Soluciona problema de funcionamiento",
        "Repara fallo detectado",
        "Corrige comportamiento inesperado"
      ],
      docs: [
        "Actualiza documentación del proyecto",
        "Mejora guías y README",
        "Agrega ejemplos de uso",
        "Documenta nuevas funcionalidades"
      ],
      style: [
        "Mejora estilos y formato del código",
        "Actualiza hojas de estilo",
        "Mejora presentación visual",
        "Optimiza diseño de interfaz"
      ],
      refactor: [
        "Mejora estructura del código",
        "Optimiza implementación existente",
        "Reorganiza componentes internos",
        "Mejora rendimiento del código"
      ],
      test: [
        "Añade pruebas unitarias",
        "Mejora cobertura de tests",
        "Corrige pruebas existentes",
        "Agrega pruebas de integración"
      ],
      chore: [
        "Actualiza configuración del proyecto",
        "Mejora scripts de construcción",
        "Actualiza dependencias",
        "Optimiza entorno de desarrollo"
      ],
      ci: [
        "Mejora configuración de CI/CD",
        "Optimiza workflows de GitHub Actions",
        "Actualiza procesos de despliegue",
        "Mejora integración continua"
      ]
    };

    const messages = templates[type] || templates.chore;
    return messages[Math.floor(Math.random() * messages.length)];
  }

  makeCommit(args) {
    // Si no se proporcionan argumentos, analizar cambios y sugerir
    if (args.length === 0) {
      const analysis = this.analyzeChanges();

      if (!analysis.hasChanges) {
        console.log('ℹ️  No hay cambios para commitear.');
        return;
      }

      console.log('\n🔍 Análisis de cambios detectados:');
      console.log('====================================');

      analysis.changes.forEach(change => {
        const icon = this.getStatusIcon(change.statusCode);
        console.log(`${icon} ${change.filePath}`);
      });

      console.log('\n📊 Resumen del análisis:');
      console.log(`   📝 Tipo de commit sugerido: ${analysis.suggestedType}`);
      console.log(`   📈 Versión sugerida: ${analysis.suggestedVersion}`);
      console.log(`   📂 Categoría principal: ${analysis.summary.type}`);
      console.log(`   📋 Detalles: ${analysis.summary.details}`);

      // Generar mensaje sugerido
      const suggestedMessage = this.getSuggestedMessage(analysis.suggestedType, analysis.categories);

      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log('\n💡 Mensaje sugerido para el commit:');
      console.log(`   "${analysis.suggestedType}: ${suggestedMessage}"`);

      rl.question('\n🤖 ¿Deseas usar el tipo y mensaje sugeridos? (s/n): ', (answer) => {
        if (answer.toLowerCase().startsWith('s')) {
          rl.question('✍️  ¿Quieres editar el mensaje sugerido? Deja vacío para usar el sugerido: ', (customMessage) => {
            const finalMessage = customMessage.trim() || suggestedMessage;
            rl.close();
            this.createCommit(analysis.suggestedType, finalMessage);
          });
        } else {
          rl.question('📝 Ingresa el tipo de commit (feat/fix/docs/style/refactor/test/chore/ci): ', (type) => {
            rl.question('✍️  Escribe el mensaje del commit: ', (message) => {
              rl.close();
              this.createCommit(type, message);
            });
          });
        }
      });

      return;
    }

    // Comportamiento original si se proporcionan argumentos
    if (args.length < 2) {
      console.error('Uso: /release commit <tipo> <mensaje>');
      console.error('Tipos: feat, fix, docs, style, refactor, test, chore, ci');
      console.error('\n💡 Consejo: Usa "/release commit" sin argumentos para análisis automático');
      process.exit(1);
    }

    const [type, ...messageParts] = args;
    const message = messageParts.join(' ');
    this.createCommit(type, message);
  }

  createCommit(type, message) {
    const validTypes = ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci'];
    if (!validTypes.includes(type)) {
      console.error(`Tipo de commit inválido: ${type}`);
      console.error(`Tipos válidos: ${validTypes.join(', ')}`);
      process.exit(1);
    }

    // Asegurar que el mensaje use formato imperativo y esté en español
    const formattedMessage = this.formatCommitMessage(message);
    const fullMessage = `${type}: ${formattedMessage}`;

    try {
      console.log(`📝 Creando commit: ${fullMessage}`);
      execSync(`git add -A`, { stdio: 'inherit' });
      execSync(`git commit -m "${fullMessage}"`, { stdio: 'inherit' });
      console.log('✅ ¡Commit creado exitosamente!');
    } catch (error) {
      console.error('❌ Error al crear commit:', error.message);
      process.exit(1);
    }
  }

  formatCommitMessage(message) {
    // Convertir a formato imperativo si no lo está ya
    let formattedMessage = message.trim();

    // Eliminar palabras iniciales comunes que no son imperativas
    const nonImperativePrefixes = [
      'Se ha ', 'Se han ', 'Se está ', 'Se están ',
      'He ', 'Ha ', 'Han ', 'Hemos ',
      'Está ', 'Están ', 'Estoy ',
      'Fue ', 'Fueron ', 'Era ', 'Eran '
    ];

    for (const prefix of nonImperativePrefixes) {
      if (formattedMessage.startsWith(prefix)) {
        formattedMessage = formattedMessage.substring(prefix.length);
        break;
      }
    }

    // Asegurar que empieza con verbo en imperativo común
    const imperativeVerbs = [
      'Añade', 'Agrega', 'Implementa', 'Crea', 'Desarrolla',
      'Corrige', 'Soluciona', 'Repara', 'Arregla', 'Fix',
      'Actualiza', 'Modifica', 'Cambia', 'Reemplaza',
      'Elimina', 'Remueve', 'Borra', 'Quita',
      'Mejora', 'Optimiza', 'Refactoriza', 'Reorganiza',
      'Documenta', 'Explica', 'Describe', 'Agrega documentación',
      'Mueve', 'Trasladada', 'Cambia ubicación', 'Reubica'
    ];

    // Si no empieza con un verbo imperativo, añadir uno adecuado según el contexto
    const startsWithImperative = imperativeVerbs.some(verb =>
      formattedMessage.toLowerCase().startsWith(verb.toLowerCase())
    );

    if (!startsWithImperative) {
      // Intentar inferir el tipo de acción
      if (formattedMessage.toLowerCase().includes('error') ||
          formattedMessage.toLowerCase().includes('bug') ||
          formattedMessage.toLowerCase().includes('fallo')) {
        formattedMessage = `Corrige ${formattedMessage}`;
      } else if (formattedMessage.toLowerCase().includes('nuev') ||
                 formattedMessage.toLowerCase().includes('funcionalidad') ||
                 formattedMessage.toLowerCase().includes('característica')) {
        formattedMessage = `Añade ${formattedMessage}`;
      } else if (formattedMessage.toLowerCase().includes('actualiz') ||
                 formattedMessage.toLowerCase().includes('cambi') ||
                 formattedMessage.toLowerCase().includes('modific')) {
        formattedMessage = `Actualiza ${formattedMessage}`;
      } else {
        formattedMessage = `Mejora ${formattedMessage}`;
      }
    }

    // Asegurar que termina con punto solo si es una oración completa
    if (formattedMessage.endsWith('.') && formattedMessage.length > 5) {
      return formattedMessage;
    } else if (formattedMessage.length > 5) {
      return formattedMessage + '.';
    }

    return formattedMessage;
  }

  getStatusIcon(statusCode) {
    if (statusCode.includes('A')) return '📁';
    if (statusCode.includes('M')) return '📝';
    if (statusCode.includes('D')) return '🗑️';
    if (statusCode.includes('R')) return '🔄';
    if (statusCode.includes('C')) return '📋';
    return '❓';
  }

  makeRelease(args) {
    // Si no se proporcionan argumentos, analizar cambios y sugerir versión
    if (args.length === 0) {
      const analysis = this.analyzeChanges();

      if (!analysis.hasChanges) {
        console.log('ℹ️  No hay cambios pendientes para release.');

        // Mostrar commits recientes que no han sido releaseados
        this.showUnreleasedCommits();
        return;
      }

      console.log('\n🔍 Análisis de cambios para Release:');
      console.log('=====================================');

      analysis.changes.forEach(change => {
        const icon = this.getStatusIcon(change.statusCode);
        console.log(`${icon} ${change.filePath}`);
      });

      console.log('\n📊 Análisis y recomendaciones:');
      console.log(`   📈 Tipo de versión sugerido: ${analysis.suggestedVersion}`);
      console.log(`   📂 Categoría principal: ${analysis.summary.type}`);
      console.log(`   📋 Resumen de cambios: ${analysis.summary.details}`);

      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      console.log('\n💡 Recomendación basada en los cambios detectados:');
      rl.question('\n🤖 ¿Deseas usar la versión sugerida? (s/n): ', (answer) => {
        if (answer.toLowerCase().startsWith('s')) {
          rl.question('\n🚀 ¿Es una versión preliminar (prerelease)? (s/n): ', (prereleaseAnswer) => {
            const prerelease = prereleaseAnswer.toLowerCase().startsWith('s');
            rl.close();
            this.createRelease(analysis.suggestedVersion, prerelease);
          });
        } else {
          rl.question('\n📈 Elige tipo de versión (major/minor/patch): ', (versionType) => {
            rl.question('🚀 ¿Es una versión preliminar (prerelease)? (s/n): ', (prereleaseAnswer) => {
              const prerelease = prereleaseAnswer.toLowerCase().startsWith('s');
              rl.close();
              this.createRelease(versionType, prerelease);
            });
          });
        }
      });

      return;
    }

    // Comportamiento original si se proporcionan argumentos
    const options = {
      major: args.includes('--major'),
      minor: args.includes('--minor'),
      patch: args.includes('--patch'),
      prerelease: args.includes('--prerelease')
    };

    if (!Object.values(options).some(Boolean)) {
      console.error('Uso: /release release [--major|--minor|--patch] [--prerelease]');
      console.error('\n💡 Consejo: Usa "/release release" sin argumentos para análisis automático');
      process.exit(1);
    }

    const bumpType = options.major ? 'major' : options.minor ? 'minor' : 'patch';
    this.createRelease(bumpType, options.prerelease);
  }

  createRelease(bumpType, prerelease = false) {
    try {
      const versionName = prerelease ? 'preliminar' : bumpType;
      console.log(`🚀 Creando release ${versionName}...`);

      // Validación pre-release usando el agente de sincronización
      console.log('\n🔍 Ejecutando validación pre-release...');
      this.executeSyncAgent(['validate']).then(isValid => {
        if (!isValid) {
          console.log('\n❌ La validación pre-release falló. Por favor, resuelve los problemas antes de continuar.');
          console.log('💡 Ejecuta "/release sync validate --fix" para corregir automáticamente los problemas.');
          process.exit(1);
        }

        // Continuar con el proceso de release original
        this.performRelease(bumpType, prerelease);
      }).catch(error => {
        console.log('\n⚠️  No se pudo ejecutar la validación pre-release, continuando con el proceso normal...');
        this.performRelease(bumpType, prerelease);
      });
    } catch (error) {
      console.error('❌ Error al crear release:', error.message);
      process.exit(1);
    }
  }

  /**
   * Ejecuta el proceso de release después de la validación
   */
  performRelease(bumpType, prerelease = false) {
    try {
      // Verificar si hay cambios sin commitear
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        console.log('⚠️  Tienes cambios sin commitear. Por favor, commitea los cambios primero.');
        process.exit(1);
      }

      // Verificar si estamos en la rama main
      const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      if (branch !== 'main') {
        console.log('⚠️  No estás en la rama main. Por favor, cambia a la rama main primero.');
        process.exit(1);
      }

      // Obtener últimos cambios
      console.log('📥 Obteniendo últimos cambios del remoto...');
      execSync('git pull origin main', { stdio: 'inherit' });

      // Crear tag de release
      const tag = `v${this.getNextVersion(bumpType, prerelease)}`;
      const tagName = prerelease ? `${tag}-pre` : tag;

      console.log(`🏷️  Creando tag: ${tagName}`);
      execSync(`git tag -a "${tagName}" -m "Release ${tagName}"`, { stdio: 'inherit' });

      console.log('📤 Enviando cambios y tags al repositorio...');
      execSync('git push origin main', { stdio: 'inherit' });
      execSync(`git push origin "${tagName}"`, { stdio: 'inherit' });

      console.log('✅ ¡Release creado exitosamente!');
      console.log('\n📋 Próximos pasos:');
      console.log('   1. Ve a GitHub para crear el Release desde el tag creado');
      console.log('   2. Esto disparará automáticamente el workflow de publicación en npm');
      console.log('   3. Verifica que el paquete se publique correctamente en npm');
      console.log('   4. Comprueba que el tag y la release aparezcan en el repositorio');

      // Sugerir verificación post-release
      console.log('\n💡 Sugerencia post-release:');
      console.log('   • Ejecuta "/release sync check" para verificar que todo quedó sincronizado');
      console.log('   • Ejecuta "/release sync report" para ver el estado completo del sistema');
    } catch (error) {
      console.error('❌ Error al crear release:', error.message);
      process.exit(1);
    }
  }

  showUnreleasedCommits() {
    try {
      const latestTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
      const commits = execSync(`git log ${latestTag}..HEAD --oneline`, { encoding: 'utf8' }).trim();

      console.log(`\n📋 Análisis de commits desde ${latestTag}:`);
      console.log('=====================================');

      if (commits) {
        console.log(commits);

        // Analizar los commits para sugerir versión
        const commitLines = commits.split('\n').filter(line => line.trim());
        const featCount = commitLines.filter(line => line.includes('feat:')).length;
        const fixCount = commitLines.filter(line => line.includes('fix:')).length;
        const docsCount = commitLines.filter(line => line.includes('docs:')).length;
        const choreCount = commitLines.filter(line => line.includes('chore:')).length;

        let suggestedVersion = 'patch';
        let versionReason = 'Solo hay cambios de documentación o mantenimiento';

        if (featCount > 0) {
          suggestedVersion = 'minor';
          versionReason = `Se detectaron ${featCount} nueva(s) funcionalidad(es)`;
        } else if (fixCount > 0) {
          suggestedVersion = 'patch';
          versionReason = `Se detectaron ${fixCount} corrección(es) de errores`;
        }

        console.log('\n📊 Resumen del análisis:');
        console.log(`   🆕 Nuevas funcionalidades (feat): ${featCount}`);
        console.log(`   🐛 Correcciones (fix): ${fixCount}`);
        console.log(`   📚 Documentación (docs): ${docsCount}`);
        console.log(`   🔧 Mantenimiento (chore): ${choreCount}`);
        console.log(`   📈 Versión recomendada: ${suggestedVersion.toUpperCase()}`);
        console.log(`   💡 Motivo: ${versionReason}`);

        if (featCount === 0 && fixCount === 0 && (docsCount > 0 || choreCount > 0)) {
          console.log('\n💡 Sugerencia: Considera crear un release PATCH para publicar mejoras de documentación y mantenimiento.');
        }
      } else {
        console.log('No hay commits nuevos desde el último tag.');
        console.log('💡 Considera hacer algunos commits antes de crear un nuevo release.');
      }
    } catch (error) {
      console.log('⚠️  No se pudo determinar el último tag o los commits.');
      console.log('   Esto podría ser un repositorio nuevo o sin tags previos.');
    }
  }

  getNextVersion(bumpType, prerelease) {
    const [major, minor, patch] = this.config.currentVersion.split('.').map(Number);

    switch (bumpType) {
      case 'major':
        return prerelease ? `${major + 1}.0.0-0` : `${major + 1}.0.0`;
      case 'minor':
        return prerelease ? `${major}.${minor + 1}.0-0` : `${major}.${minor + 1}.0`;
      case 'patch':
        return prerelease ? `${major}.${minor}.${patch + 1}-0` : `${major}.${minor}.${patch + 1}`;
      default:
        return this.config.currentVersion;
    }
  }

  showConfiguration() {
    console.log('\n⚙️  Configuración Actual');
    console.log('========================');

    console.log('📦 Configuración del Paquete:');
    console.log(`  Nombre: ${this.config.packageName}`);
    console.log(`  Versión: ${this.config.currentVersion}`);

    if (this.config.releasePlease) {
      console.log('\n🤖 Release-please Configuration:');
      console.log(JSON.stringify(this.config.releasePlease, null, 2));
    }

    console.log('\n🔗 Próximos Pasos:');
    console.log('1. Asegúrate de que NPM_TOKEN esté configurado en los secrets de GitHub');
    console.log('2. Usa commits convencionales para tus cambios');
    console.log('3. Sube los cambios a la rama main');
    console.log('4. Release-please creará un Release PR');
    console.log('5. Fusiona el Release PR para publicar en npm');
  }

  verifySetup() {
    console.log('\n🔍 Verificando Configuración');
    console.log('==================');

    let allGood = true;

    // Check required files
    const requiredFiles = [
      '.github/release-please-config.json',
      '.github/.release-please-manifest.json',
      '.github/workflows/release-please.yml',
      '.github/workflows/publish-npm.yml',
      '.husky/commit-msg',
      '.husky/pre-commit',
      'commitlint.config.js'
    ];

    requiredFiles.forEach(file => {
      const path = join(this.projectRoot, file);
      if (existsSync(path)) {
        console.log(`✅ ${file}`);
      } else {
        console.log(`❌ ${file} - Missing`);
        allGood = false;
      }
    });

    // Check package.json scripts
    const packageJson = JSON.parse(readFileSync(join(this.projectRoot, 'package.json'), 'utf8'));
    if (packageJson.scripts && packageJson.scripts.prepare) {
      console.log('✅ prepare script in package.json');
    } else {
      console.log('❌ prepare script missing from package.json');
      allGood = false;
    }

    // Check git status
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        console.log('⚠️  Uncommitted changes detected');
      } else {
        console.log('✅ No uncommitted changes');
      }
    } catch (error) {
      console.log('❌ Fallo en la verificación de estado de git');
      allGood = false;
    }

    console.log('\n' + (allGood ? '✅ ¡Todas las verificaciones pasaron!' : '❌ Se encontraron algunos problemas. Por favor, arréglalos antes de continuar.'));

    if (!allGood) {
      console.log('\n💡 Ejecuta el script de configuración nuevamente: powershell -ExecutionPolicy Bypass -File setup-conventional-release.ps1');
      process.exit(1);
    }
  }

  showHelp() {
    console.log(`
🚀 Comando de Gestión de Releases - Edición Inteligente

Uso: /release [acción] [opciones]

Acciones:
  status [--verbose]           Muestra el estado actual del release
  commit [tipo] [mensaje]     Crea commit convencional (modo inteligente sin argumentos)
  release [--major|--minor|--patch] [--prerelease]  Crea release (modo inteligente sin argumentos)
  configure                    Muestra configuración actual
  verify                       Verifica configuración
  help                         Muestra esta ayuda

🤖 Características Inteligentes:
  • /release commit        - Analiza cambios automáticamente y sugiere tipo de commit
  • /release release       - Analiza commits y sugiere versión
  • Confirmación interactiva para todas las sugerencias
  • Generación automática de mensajes en español

Tipos de Commit:
  feat     Nueva funcionalidad (sugiere versión minor)
  fix      Corrección de error (sugiere versión patch)
  docs     Cambios en documentación
  style    Cambios de estilo y formato
  refactor Refactorización de código
  test     Cambios en pruebas
  chore    Tareas de mantenimiento
  ci       Cambios en CI/CD

Ejemplos:
  /release status --verbose
  /release commit              # Modo inteligente - análisis automático
  /release commit feat "Añade nueva funcionalidad"
  /release release             # Modo inteligente - sugerencia de versión
  /release release --minor
  /release verify

Características de Análisis Inteligente:
  • Categorización automática de archivos modificados
  • Evaluación de impacto en versión
  • Análisis de historial de commits
  • Flujo de trabajo interactivo en español
  • Generación de mensajes contextualizados

🤖 Comandos de Sincronización:
  • /release sync check [--verbose] [--fix]     Verifica consistencia de versiones
  • /release sync fix [--force]                 Corrige inconsistencias automáticamente
  • /release sync validate [--fix]              Valida antes de crear release
  • /release sync report [--detailed]           Genera reporte de estado
`);
  }

  /**
   * Ejecuta acciones del subagente de sincronización
   */
  async executeSyncAgent(args) {
    try {
      // Importar dinámicamente el agente de sincronización
      const syncAgentPath = join(__dirname, 'release-sync-agent.js');
      const SyncAgent = (await import(syncAgentPath)).default;
      const agent = new SyncAgent();
      return await agent.execute(args);
    } catch (error) {
      console.error('❌ Error al ejecutar el agente de sincronización:', error.message);
      console.log('💡 Asegúrate de que el archivo release-sync-agent.js exista en el mismo directorio.');
      process.exit(1);
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = new ReleaseCommand();
  command.execute(process.argv.slice(2)).catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

export default ReleaseCommand;