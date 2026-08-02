const { withGradleProperties } = require('@expo/config-plugins');

const ASYNC_STORAGE_DB_SIZE_KEY = 'AsyncStorage_db_size_in_MB';
const ASYNC_STORAGE_DB_SIZE_MB = '25';

module.exports = function withAsyncStorageDbSize(config) {
  return withGradleProperties(config, (configWithGradleProperties) => {
    const properties = configWithGradleProperties.modResults;
    const existingIndex = properties.findIndex(
      item => item.type === 'property' && item.key === ASYNC_STORAGE_DB_SIZE_KEY
    );

    const property = {
      type: 'property',
      key: ASYNC_STORAGE_DB_SIZE_KEY,
      value: ASYNC_STORAGE_DB_SIZE_MB,
    };

    if (existingIndex >= 0) {
      properties[existingIndex] = property;
    } else {
      properties.push(property);
    }

    return configWithGradleProperties;
  });
};
