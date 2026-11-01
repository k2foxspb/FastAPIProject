module.exports = function(api) {
  api.cache(true);
  const isProduction = process.env.NODE_ENV === 'production';
  const plugins = [];
  if (isProduction) {
    // В production удаляем все console.* из бандла. Логи через logger-хелпер
    // (src/utils/logger.js) выключены в production, поэтому потерь диагностики нет.
    // Требует: npm install --save-dev babel-plugin-transform-remove-console
    plugins.push('transform-remove-console');
  }
  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
