module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'presentation-no-database',
      severity: 'error',
      from: { path: '/presentation/' },
      to: { path: '/(?:generated|infrastructure)/|node_modules/(?:@prisma|pg)' },
    },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '/domain/' },
      to: { path: '/(?:presentation|application|infrastructure|generated)/|node_modules/' },
    },
    {
      name: 'module-private-internals',
      severity: 'error',
      from: { path: 'apps/api/src/modules/([^/]+)/' },
      to: { path: 'apps/api/src/modules/(?!$1/)[^/]+/(?:domain|infrastructure|presentation)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|/generated/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.boundaries.json' },
    exclude: { path: '/generated/' },
  },
};
