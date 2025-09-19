#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Release Sync Agent - Subagente Especializado en Sincronización de Releases
 *
 * Este subagente previene y corrige automáticamente inconsistencias entre:
 * - package.json
 * - release-please manifest
 * - GitHub tags
 * - GitHub releases
 * - npm package version
 *
 * Características:
 * - Detección automática de inconsistencias
 * - Validación de consistencia antes de publicar
 * - Corrección automática de problemas
 * - Reportes detallados de estado
 * - Integración con el comando /release existente
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ReleaseSyncAgent {
  constructor() {
    this.projectRoot = process.cwd();
    this.issues = [];
    this.sources = {
      packageJson: null,
      releasePleaseManifest: null,
      gitTags: [],
      npmVersion: null
    };
    this.reports = {
      consistency: null,
      recommendations: [],
      warnings: [],
      errors: []
    };
  }

  /**
   * Punto de entrada principal del agente
   */
  async execute(args) {
    const [action, ...restArgs] = args;

    switch (action) {
      case 'check':
        return this.checkConsistency(restArgs);
      case 'fix':
        return this.fixIssues(restArgs);
      case 'validate':
        return this.validateBeforeRelease(restArgs);
      case 'sync':
        return this.synchronizeAll(restArgs);
      case 'report':
        return this.generateReport(restArgs);
      case 'monitor':
        return this.monitorChanges(restArgs);
      case 'help':
      default:
        return this.showHelp();
    }
  }

  /**
   * Verifica consistencia entre todas las fuentes de versiones
   */
  async checkConsistency(args) {
    const verbose = args.includes('--verbose');
    const fix = args.includes('--fix');

    console.log('\n🔍 Verificando Consistencia de Versiones');
    console.log('=========================================');

    await this.collectVersionSources();
    await this.detectInconsistencies();

    if (this.issues.length === 0) {
      console.log('✅ Todas las versiones están sincronizadas');
      return true;
    }

    console.log(`\n❌ Se detectaron ${this.issues.length} inconsistencias:`);
    this.issues.forEach((issue, index) => {
      console.log(`\n${index + 1}. ${issue.type}`);
      console.log(`   📍 Ubicación: ${issue.location}`);
      console.log(`   📝 Descripción: ${issue.description}`);
      console.log(`   💡 Solución: ${issue.solution}`);

      if (verbose) {
        console.log(`   🔧 Detalles: ${JSON.stringify(issue.details, null, 2)}`);
      }
    });

    if (fix) {
      console.log('\n🔧 Aplicando correcciones automáticas...');
      return await this.fixIssues(args);
    }

    return false;
  }

  /**
   * Recopila información de todas las fuentes de versiones
   */
  async collectVersionSources() {
    try {
      // Package.json
      const packagePath = join(this.projectRoot, 'package.json');
      if (existsSync(packagePath)) {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
        this.sources.packageJson = {
          version: packageJson.version,
          name: packageJson.name,
          path: packagePath
        };
      }

      // Release-please manifest
      const manifestPath = join(this.projectRoot, '.github', '.release-please-manifest.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        this.sources.releasePleaseManifest = {
          version: manifest['.'],
          path: manifestPath
        };
      }

      // Git tags
      try {
        const tagOutput = execSync('git tag --list', { encoding: 'utf8' });
        this.sources.gitTags = tagOutput.trim().split('\n').filter(tag => tag.trim());
      } catch (error) {
        this.reports.warnings.push('No se pudieron obtener los git tags');
      }

      // npm version (si está publicado)
      try {
        const npmInfo = execSync(`npm view ${this.sources.packageJson?.name} version`, {
          encoding: 'utf8',
          stdio: 'pipe'
        });
        this.sources.npmVersion = npmInfo.trim();
      } catch (error) {
        // El paquete podría no estar publicado aún
        this.reports.warnings.push('No se pudo obtener la versión de npm (el paquete podría no estar publicado)');
      }

    } catch (error) {
      console.error('❌ Error al recopilar fuentes de versiones:', error.message);
    }
  }

  /**
   * Detecta inconsistencias entre las fuentes
   */
  async detectInconsistencies() {
    this.issues = [];

    // Verificar consistencia entre package.json y release-please manifest
    if (this.sources.packageJson && this.sources.releasePleaseManifest) {
      if (this.sources.packageJson.version !== this.sources.releasePleaseManifest.version) {
        this.issues.push({
          type: 'Versión desincronizada entre package.json y release-please manifest',
          location: `${this.sources.packageJson.path} vs ${this.sources.releasePleaseManifest.path}`,
          description: `package.json: ${this.sources.packageJson.version}, manifest: ${this.sources.releasePleaseManifest.version}`,
          solution: 'Sincronizar las versiones manualmente o usando --fix',
          severity: 'high',
          details: {
            packageJson: this.sources.packageJson.version,
            manifest: this.sources.releasePleaseManifest.version
          }
        });
      }
    }

    // Verificar tags inconsistentes
    const inconsistentTags = this.findInconsistentTags();
    inconsistentTags.forEach(tag => {
      this.issues.push({
        type: 'Formato de tag inconsistente',
        location: 'git tags',
        description: `Tag con formato incorrecto: ${tag}`,
        solution: 'Renombrar el tag al formato estándar (vX.Y.Z)',
        severity: 'medium',
        details: { tag }
      });
    });

    // Verificar tags duplicados
    const duplicateTags = this.findDuplicateTags();
    duplicateTags.forEach(duplicate => {
      this.issues.push({
        type: 'Tags duplicados para la misma versión',
        location: 'git tags',
        description: `Múltiples tags para versión ${duplicate.version}: ${duplicate.tags.join(', ')}`,
        solution: `Eliminar los tags duplicados y mantener solo el formato estándar: v${duplicate.version}`,
        severity: 'high',
        details: duplicate
      });
    });

    // Verificar si hay tags que no coinciden con ninguna versión conocida
    const orphanedTags = this.findOrphanedTags();
    orphanedTags.forEach(tag => {
      this.issues.push({
        type: 'Tag huérfano',
        location: 'git tags',
        description: `Tag ${tag} no corresponde a ninguna versión conocida`,
        solution: 'Verificar si el tag es necesario o eliminarlo',
        severity: 'low',
        details: { tag }
      });
    });

    // Verificar consistencia con npm
    if (this.sources.packageJson && this.sources.npmVersion) {
      if (this.sources.packageJson.version !== this.sources.npmVersion) {
        this.issues.push({
          type: 'Versión desincronizada con npm',
          location: 'package.json vs npm registry',
          description: `Local: ${this.sources.packageJson.version}, npm: ${this.sources.npmVersion}`,
          solution: 'Publicar la versión actual en npm o actualizar package.json',
          severity: 'medium',
          details: {
            local: this.sources.packageJson.version,
            npm: this.sources.npmVersion
          }
        });
      }
    }
  }

  /**
   * Encuentra tags con formatos inconsistentes
   */
  findInconsistentTags() {
    return this.sources.gitTags.filter(tag => {
      // Formatos válidos: v1.2.0
      const validFormat = /^v\d+\.\d+\.\d+(-[a-zA-Z0-9-]+)?$/;
      return !validFormat.test(tag) && !tag.startsWith('create-react-ts-vite-v');
    });
  }

  /**
   * Encuentra tags duplicados para la misma versión
   */
  findDuplicateTags() {
    const versionMap = new Map();

    this.sources.gitTags.forEach(tag => {
      let version = null;

      if (tag.startsWith('v')) {
        version = tag.substring(1);
      } else if (tag.startsWith('create-react-ts-vite-v')) {
        version = tag.substring('create-react-ts-vite-v'.length);
      }

      if (version && /^\d+\.\d+\.\d+(-[a-zA-Z0-9-]+)?$/.test(version)) {
        if (!versionMap.has(version)) {
          versionMap.set(version, []);
        }
        versionMap.get(version).push(tag);
      }
    });

    return Array.from(versionMap.entries())
      .filter(([_, tags]) => tags.length > 1)
      .map(([version, tags]) => ({ version, tags }));
  }

  /**
   * Encuentra tags que no corresponden a versiones conocidas
   */
  findOrphanedTags() {
    const knownVersions = new Set();

    if (this.sources.packageJson) {
      knownVersions.add(this.sources.packageJson.version);
    }

    if (this.sources.releasePleaseManifest) {
      knownVersions.add(this.sources.releasePleaseManifest.version);
    }

    return this.sources.gitTags.filter(tag => {
      let version = null;

      if (tag.startsWith('v')) {
        version = tag.substring(1);
      } else if (tag.startsWith('create-react-ts-vite-v')) {
        version = tag.substring('create-react-ts-vite-v'.length);
      }

      return version && !knownVersions.has(version);
    });
  }

  /**
   * Corrige automáticamente las inconsistencias detectadas
   */
  async fixIssues(args) {
    const force = args.includes('--force');

    if (this.issues.length === 0) {
      console.log('✅ No hay inconsistencias que corregir');
      return true;
    }

    console.log('\n🔧 Corrigiendo Inconsistencias');
    console.log('============================');

    let fixedCount = 0;
    let skippedCount = 0;

    for (const issue of this.issues) {
      console.log(`\n📋 Corrigiendo: ${issue.type}`);

      try {
        const success = await this.fixIssue(issue, force);
        if (success) {
          console.log(`   ✅ Corregido: ${issue.description}`);
          fixedCount++;
        } else {
          console.log(`   ⚠️  Omitido: ${issue.description}`);
          skippedCount++;
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        skippedCount++;
      }
    }

    console.log(`\n📊 Resumen de corrección:`);
    console.log(`   ✅ Corregidos: ${fixedCount}`);
    console.log(`   ⚠️  Omitidos: ${skippedCount}`);

    if (fixedCount > 0) {
      console.log('\n💡 Es recomendable ejecutar una nueva verificación con "/release sync check"');
    }

    return fixedCount > 0;
  }

  /**
   * Corrige un problema específico
   */
  async fixIssue(issue, force) {
    switch (issue.type) {
      case 'Versión desincronizada entre package.json y release-please manifest':
        return this.fixPackageManifestSync(issue, force);

      case 'Formato de tag inconsistente':
        return this.fixInconsistentTag(issue, force);

      case 'Tags duplicados para la misma versión':
        return this.fixDuplicateTags(issue, force);

      case 'Versión desincronizada con npm':
        return this.fixNpmSync(issue, force);

      default:
        console.log(`   ⚠️  Tipo de problema no manejado automáticamente: ${issue.type}`);
        return false;
    }
  }

  /**
   * Corrige sincronización entre package.json y manifest
   */
  async fixPackageManifestSync(issue, force) {
    if (!force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`   🤖 ¿Sincronizar package.json con manifest? (s/n): `, resolve);
      });
      rl.close();

      if (!answer.toLowerCase().startsWith('s')) {
        return false;
      }
    }

    // Usar la versión del package.json como fuente de verdad
    const packageJson = JSON.parse(readFileSync(this.sources.packageJson.path, 'utf8'));
    const manifestPath = this.sources.releasePleaseManifest.path;

    const manifest = {
      ".": packageJson.version
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // Actualizar la fuente en memoria
    this.sources.releasePleaseManifest.version = packageJson.version;

    console.log(`   📝 Manifest actualizado a: ${packageJson.version}`);
    return true;
  }

  /**
   * Corrige tags con formato inconsistente
   */
  async fixInconsistentTag(issue, force) {
    const tag = issue.details.tag;

    if (!force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`   🤖 ¿Eliminar tag con formato incorrecto "${tag}"? (s/n): `, resolve);
      });
      rl.close();

      if (!answer.toLowerCase().startsWith('s')) {
        return false;
      }
    }

    try {
      execSync(`git tag -d "${tag}"`, { stdio: 'pipe' });

      // También eliminar del remoto si existe
      try {
        execSync(`git push origin :refs/tags/"${tag}"`, { stdio: 'pipe' });
      } catch (error) {
        // El tag podría no existir en el remoto
      }

      console.log(`   🗑️  Tag eliminado: ${tag}`);

      // Actualizar la lista de tags en memoria
      this.sources.gitTags = this.sources.gitTags.filter(t => t !== tag);

      return true;
    } catch (error) {
      console.log(`   ❌ Error al eliminar tag: ${error.message}`);
      return false;
    }
  }

  /**
   * Corrige tags duplicados
   */
  async fixDuplicateTags(issue, force) {
    const { version, tags } = issue.details;

    if (!force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`   🤖 ¿Eliminar tags duplicados para versión ${version}? (s/n): `, resolve);
      });
      rl.close();

      if (!answer.toLowerCase().startsWith('s')) {
        return false;
      }
    }

    let success = true;
    const standardTag = `v${version}`;
    const tagsToDelete = tags.filter(tag => tag !== standardTag);

    for (const tag of tagsToDelete) {
      try {
        execSync(`git tag -d "${tag}"`, { stdio: 'pipe' });

        // También eliminar del remoto si existe
        try {
          execSync(`git push origin :refs/tags/"${tag}"`, { stdio: 'pipe' });
        } catch (error) {
          // El tag podría no existir en el remoto
        }

        console.log(`   🗑️  Tag duplicado eliminado: ${tag}`);
      } catch (error) {
        console.log(`   ❌ Error al eliminar tag ${tag}: ${error.message}`);
        success = false;
      }
    }

    if (success) {
      // Actualizar la lista de tags en memoria
      this.sources.gitTags = this.sources.gitTags.filter(tag => !tagsToDelete.includes(tag));
    }

    return success;
  }

  /**
   * Corrige sincronización con npm
   */
  async fixNpmSync(issue, force) {
    if (!force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        rl.question(`   🤖 ¿Publicar versión local ${issue.details.local} en npm? (s/n): `, resolve);
      });
      rl.close();

      if (!answer.toLowerCase().startsWith('s')) {
        return false;
      }
    }

    try {
      console.log(`   📤 Publicando en npm...`);
      execSync('npm publish', { stdio: 'inherit' });
      console.log(`   ✅ Versión ${issue.details.local} publicada en npm`);

      // Actualizar la fuente en memoria
      this.sources.npmVersion = issue.details.local;

      return true;
    } catch (error) {
      console.log(`   ❌ Error al publicar en npm: ${error.message}`);
      return false;
    }
  }

  /**
   * Valida consistencia antes de crear un release
   */
  async validateBeforeRelease(args) {
    console.log('\n🔍 Validando Sistema Antes del Release');
    console.log('======================================');

    const issues = await this.runPreReleaseChecks();

    if (issues.length === 0) {
      console.log('✅ Sistema listo para release');
      return true;
    }

    console.log(`\n❌ Se encontraron ${issues.length} problemas que impiden el release:`);
    issues.forEach((issue, index) => {
      console.log(`\n${index + 1}. ${issue.type}`);
      console.log(`   📍 ${issue.description}`);
      console.log(`   💡 ${issue.solution}`);

      if (issue.blocking) {
        console.log(`   🚫 BLOQUEANTE - Debe resolverse antes del release`);
      }
    });

    const blockingIssues = issues.filter(issue => issue.blocking);
    if (blockingIssues.length > 0) {
      console.log(`\n🚫 El release está BLOQUEADO por ${blockingIssues.length} problemas críticos`);
      return false;
    }

    const fix = args.includes('--fix');
    if (fix) {
      console.log('\n🔧 Intentando corregir problemas automáticamente...');
      const fixed = await this.fixIssues(args);
      return fixed;
    }

    return false;
  }

  /**
   * Ejecuta verificaciones previas al release
   */
  async runPreReleaseChecks() {
    const issues = [];

    // Verificar consistencia de versiones
    await this.collectVersionSources();
    await this.detectInconsistencies();

    // Marcar problemas de versión como bloqueantes
    this.issues.forEach(issue => {
      issues.push({
        ...issue,
        blocking: issue.severity === 'high'
      });
    });

    // Verificar si hay cambios sin commitear
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      if (status.trim()) {
        issues.push({
          type: 'Cambios sin commitear',
          description: 'Hay cambios en el working directory que no han sido commiteados',
          solution: 'Commitear todos los cambios antes de crear el release',
          blocking: true
        });
      }
    } catch (error) {
      issues.push({
        type: 'Error en verificación de git',
        description: 'No se pudo verificar el estado de git',
        solution: 'Verificar que git esté funcionando correctamente',
        blocking: true
      });
    }

    // Verificar que estamos en la rama correcta
    try {
      const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      if (branch !== 'main') {
        issues.push({
          type: 'Rama incorrecta',
          description: `Estás en la rama '${branch}', pero los releases deben hacerse desde 'main'`,
          solution: 'Cambiar a la rama main: git checkout main',
          blocking: true
        });
      }
    } catch (error) {
      issues.push({
        type: 'Error en verificación de rama',
        description: 'No se pudo verificar la rama actual',
        solution: 'Verificar que git esté funcionando correctamente',
        blocking: true
      });
    }

    // Verificar sincronización con el remoto
    try {
      execSync('git fetch origin', { stdio: 'pipe' });
      const localHash = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
      const remoteHash = execSync('git rev-parse origin/main', { encoding: 'utf8' }).trim();

      if (localHash !== remoteHash) {
        issues.push({
          type: 'Desincronización con remoto',
          description: 'La rama local no está sincronizada con el remoto',
          solution: 'Hacer pull de los cambios remotos: git pull origin main',
          blocking: true
        });
      }
    } catch (error) {
      issues.push({
        type: 'Error en verificación de remoto',
        description: 'No se pudo verificar la sincronización con el remoto',
        solution: 'Verificar la conexión con el repositorio remoto',
        blocking: true
      });
    }

    return issues;
  }

  /**
   * Sincroniza todas las fuentes de versiones
   */
  async synchronizeAll(args) {
    console.log('\n🔄 Sincronizando Todas las Fuentes');
    console.log('==================================');

    const force = args.includes('--force');

    await this.collectVersionSources();
    await this.detectInconsistencies();

    if (this.issues.length === 0) {
      console.log('✅ Todas las fuentes ya están sincronizadas');
      return true;
    }

    console.log(`📋 Se detectaron ${this.issues.length} inconsistencias para sincronizar`);

    const success = await this.fixIssues(args);

    if (success) {
      console.log('\n✅ Sincronización completada');

      // Verificación final
      console.log('\n🔍 Verificación final...');
      await this.collectVersionSources();
      await this.detectInconsistencies();

      if (this.issues.length === 0) {
        console.log('✅ Todas las fuentes están perfectamente sincronizadas');
        return true;
      } else {
        console.log(`⚠️  Quedan ${this.issues.length} problemas por resolver manualmente`);
        return false;
      }
    }

    return false;
  }

  /**
   * Genera reporte detallado del estado
   */
  async generateReport(args) {
    console.log('\n📊 Generando Reporte de Estado');
    console.log('==============================');

    const detailed = args.includes('--detailed');
    const json = args.includes('--json');

    await this.collectVersionSources();
    await this.detectInconsistencies();

    const report = {
      timestamp: new Date().toISOString(),
      projectName: this.sources.packageJson?.name || 'Unknown',
      summary: {
        totalIssues: this.issues.length,
        criticalIssues: this.issues.filter(i => i.severity === 'high').length,
        mediumIssues: this.issues.filter(i => i.severity === 'medium').length,
        lowIssues: this.issues.filter(i => i.severity === 'low').length
      },
      sources: {
        packageJson: this.sources.packageJson?.version || 'Not found',
        releasePleaseManifest: this.sources.releasePleaseManifest?.version || 'Not found',
        gitTags: this.sources.gitTags.length,
        npmVersion: this.sources.npmVersion || 'Not published'
      },
      issues: this.issues,
      recommendations: this.generateRecommendations()
    };

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return true;
    }

    console.log('\n📋 Resumen:');
    console.log(`   📦 Proyecto: ${report.projectName}`);
    console.log(`   🔢 Problemas totales: ${report.summary.totalIssues}`);
    console.log(`   🚨 Críticos: ${report.summary.criticalIssues}`);
    console.log(`   ⚠️  Medios: ${report.summary.mediumIssues}`);
    console.log(`   ℹ️  Leves: ${report.summary.lowIssues}`);

    console.log('\n📊 Estado de Fuentes:');
    console.log(`   📄 package.json: ${report.sources.packageJson}`);
    console.log(`   🤖 Manifest: ${report.sources.releasePleaseManifest}`);
    console.log(`   🏷️  Git Tags: ${report.sources.gitTags} tags`);
    console.log(`   📦 npm: ${report.sources.npmVersion}`);

    if (report.issues.length > 0) {
      console.log('\n🚨 Problemas Detectados:');
      report.issues.forEach((issue, index) => {
        const severityIcon = issue.severity === 'high' ? '🚨' : issue.severity === 'medium' ? '⚠️' : 'ℹ️';
        console.log(`   ${index + 1}. ${severityIcon} ${issue.type}`);
      });
    }

    if (report.recommendations.length > 0) {
      console.log('\n💡 Recomendaciones:');
      report.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. ${rec}`);
      });
    }

    if (detailed) {
      console.log('\n🔍 Detalles Completo:');
      console.log(JSON.stringify(report, null, 2));
    }

    return true;
  }

  /**
   * Genera recomendaciones basadas en los problemas detectados
   */
  generateRecommendations() {
    const recommendations = [];

    if (this.issues.length === 0) {
      recommendations.push('El sistema está perfectamente sincronizado. Continúa con tu flujo de trabajo normal.');
      return recommendations;
    }

    const criticalIssues = this.issues.filter(i => i.severity === 'high');
    if (criticalIssues.length > 0) {
      recommendations.push('Resuelve los problemas críticos antes de crear un nuevo release.');
      recommendations.push('Ejecuta "/release sync fix --force" para corregir automáticamente.');
    }

    const versionIssues = this.issues.filter(i => i.type.includes('Versión desincronizada'));
    if (versionIssues.length > 0) {
      recommendations.push('Establece una fuente de verdad para las versiones (recomendado: package.json).');
    }

    const tagIssues = this.issues.filter(i => i.type.includes('tag'));
    if (tagIssues.length > 0) {
      recommendations.push('Estandariza el formato de los tags a v1.2.0 para evitar confusiones.');
    }

    if (this.issues.some(i => i.type.includes('npm'))) {
      recommendations.push('Verifica tu configuración de npm y los tokens de acceso.');
    }

    recommendations.push('Configura validaciones automáticas en tu pipeline de CI/CD.');
    recommendations.push('Documenta el proceso de release para tu equipo.');

    return recommendations;
  }

  /**
   * Monitorea cambios continuamente
   */
  async monitorChanges(args) {
    console.log('\n👀 Iniciando Monitoreo Continuo');
    console.log('================================');

    const interval = parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1]) || 30000;

    console.log(`🔄 Monitoreando cada ${interval/1000} segundos...`);
    console.log('⚠️  Presiona Ctrl+C para detener el monitoreo');

    const checkLoop = async () => {
      await this.collectVersionSources();
      const oldIssues = [...this.issues];
      await this.detectInconsistencies();

      const newIssues = this.issues.filter(issue =>
        !oldIssues.some(old => old.type === issue.type && old.description === issue.description)
      );

      if (newIssues.length > 0) {
        console.log(`\n🚨 Nuevos problemas detectados (${new Date().toLocaleTimeString()}):`);
        newIssues.forEach(issue => {
          console.log(`   • ${issue.type}: ${issue.description}`);
        });
      }

      setTimeout(checkLoop, interval);
    };

    await checkLoop();
  }

  /**
   * Muestra ayuda del subagente
   */
  showHelp() {
    console.log(`
🤖 Release Sync Agent - Subagente de Sincronización de Releases

Este subagente previene y corrige automáticamente inconsistencias entre todas las fuentes de versiones.

Uso: /release sync [acción] [opciones]

Acciones:
  check [--verbose] [--fix]     Verifica consistencia entre todas las fuentes
  fix [--force]                 Corrige automáticamente las inconsistencias
  validate [--fix]              Valida sistema antes de crear release
  sync [--force]                Sincroniza todas las fuentes
  report [--detailed] [--json]  Genera reporte detallado del estado
  monitor [--interval=SEG]      Monitorea cambios continuamente
  help                         Muestra esta ayuda

Opciones:
  --force               Ejecuta acciones sin confirmación
  --fix                 Aplica correcciones automáticamente
  --verbose             Muestra información detallada
  --detailed           Reporte con información completa
  --json               Salida en formato JSON
  --interval=SEG       Intervalo de monitoreo en segundos

Fuentes Monitoreadas:
  • package.json          Versión principal del paquete
  • release-please manifest  Versión para release automation
  • Git tags             Tags de versión en el repositorio
  • npm registry         Versión publicada en npm

Problemas Detectados:
  • Versiones desincronizadas entre fuentes
  • Tags con formatos inconsistentes
  • Tags duplicados para la misma versión
  • Tags huérfanos sin versión correspondiente
  • Desincronización con npm registry

Ejemplos:
  /release sync check --verbose
  /release sync check --fix
  /release sync fix --force
  /release sync validate
  /release sync report --detailed
  /release sync monitor --interval=60

Integración con /release:
  El subagente se integra automáticamente con el comando /release existente,
  proporcionando validaciones adicionales y corrección de problemas.

Características:
  • Detección automática de inconsistencias
  • Validación preventiva antes de releases
  • Corrección automática con confirmación
  • Monitoreo continuo de cambios
  • Reportes detallados del estado
`);
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new ReleaseSyncAgent();
  agent.execute(process.argv.slice(2)).catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

export default ReleaseSyncAgent;