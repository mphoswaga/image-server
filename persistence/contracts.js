const path = require('path');

const REPOSITORY_METHODS = Object.freeze({
  identities: ['getById', 'getByEducscopeId', 'upsert'],
  rosters: ['get', 'listByTeacher', 'save', 'remove'],
  assignments: ['get', 'listByTeacher', 'save', 'saveSubmission'],
  practiceAttempts: ['get', 'findResumable', 'listByTeacher', 'save'],
  liveRooms: ['getByCode', 'listByTeacher', 'save', 'close'],
  planningAssets: ['get', 'listByOwner', 'saveMetadata', 'remove'],
  decks: ['get', 'listByOwner', 'save', 'remove'],
});

function assertRepositorySet(repositories) {
  if (!repositories || typeof repositories !== 'object') throw new TypeError('Repository set is required.');
  for (const [domain, methods] of Object.entries(REPOSITORY_METHODS)) {
    const repository = repositories[domain];
    if (!repository) throw new TypeError(`Missing ${domain} repository.`);
    for (const method of methods) {
      if (typeof repository[method] !== 'function') throw new TypeError(`${domain}.${method} must be a function.`);
    }
  }
  return repositories;
}

function cleanSegment(value, label) {
  const segment = String(value || '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) {
    throw new TypeError(`${label} contains an unsafe storage-key segment.`);
  }
  return segment;
}

function objectKey({ ownerId, domain, recordId, filename }) {
  return [
    'users',
    cleanSegment(ownerId, 'ownerId'),
    cleanSegment(domain, 'domain'),
    cleanSegment(recordId, 'recordId'),
    cleanSegment(path.basename(String(filename || 'file')), 'filename'),
  ].join('/');
}

function assertObjectStore(store) {
  for (const method of ['put', 'get', 'remove', 'exists']) {
    if (!store || typeof store[method] !== 'function') throw new TypeError(`Object store ${method} must be a function.`);
  }
  return store;
}

module.exports = { REPOSITORY_METHODS, assertRepositorySet, objectKey, assertObjectStore };
