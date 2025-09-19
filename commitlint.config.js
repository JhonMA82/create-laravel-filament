export default {
  extends: ['@commitlint/config-conventional'],
  // Configuración para soportar mensajes en español
  rules: {
    // Permitir mensajes en español pero manteniendo el formato conventional commits
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'style', 'refactor', 'test', 'chore', 'ci']],
    'subject-case': [0, 'never'], // No forzar mayúsculas en español
    'header-max-length': [2, 'always', 100], // Aumentar límite para español
  },
  // Mensajes personalizados en español
  prompt: {
    questions: {
      type: {
        description: 'Seleccione el tipo de cambio que está realizando:',
        enum: {
          feat: {
            description: 'Una nueva funcionalidad',
            title: 'Funcionalidades',
            emoji: '✨',
          },
          fix: {
            description: 'Una corrección de error',
            title: 'Correcciones',
            emoji: '🐛',
          },
          docs: {
            description: 'Cambios en la documentación',
            title: 'Documentación',
            emoji: '📚',
          },
          style: {
            description: 'Cambios que no afectan el significado del código (espacios, formato)',
            title: 'Estilos',
            emoji: '💎',
          },
          refactor: {
            description: 'Un cambio de código que no corrige un error ni añade una funcionalidad',
            title: 'Refactorización',
            emoji: '📦',
          },
          test: {
            description: 'Añadir o corregir tests',
            title: 'Tests',
            emoji: '🚨',
          },
          chore: {
            description: 'Cambios en el proceso de construcción o herramientas auxiliares',
            title: 'Mantenimiento',
            emoji: '🔧',
          },
          ci: {
            description: 'Cambios en la configuración de CI',
            title: 'CI',
            emoji: '👷',
          },
        },
      },
      scope: {
        description: '¿Cuál es el alcance de este cambio (componente, archivo, etc.)?',
      },
      subject: {
        description: 'Escriba una descripción corta e imperativa del cambio:',
      },
      body: {
        description: 'Proporcione una descripción más detallada del cambio:',
      },
      isBreaking: {
        description: '¿Hay algún cambio rompedor (breaking change)?',
      },
      breakingBody: {
        description: 'Descripción detallada del cambio rompedor:',
      },
      breaking: {
        description: 'Describa el cambio rompedor:',
      },
      isIssueAffected: {
        description: '¿Este cambio afecta algún issue abierto?',
      },
      issuesBody: {
        description: 'Si los issues están cerrados, el commit requiere un body. Por favor ingrese una descripción más detallada del cambio:',
      },
      issues: {
        description: 'Añada referencias a issues (ej. "fix #123", "re #123".):',
      },
    },
  },
};
