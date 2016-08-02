var contract = require('dbc')
var FileCache = require('./file')
var RedisCache = require('./redis')
var _ = require('underscore')
var log = require('@dadi/logger')

log.init({
  enabled: true,
  level: 'warn',
  filename: 'cache',
  extension: '.log'
})

/**
 * Creates a new Cache instance
 * @constructor
 * @param {object} [options={ directory: { enabled: true, path: './cache' }, redis: { enabled: false } }] - the options used to instantiate Cache Handlers
 * @example
 * var Cache = require('@dadi/cache')
 * var cache = new Cache({
 *   "ttl": 3600,
 *   "directory": {
 *     "enabled": false,
 *     "path": "./cache/"
 *   },
 *   "redis": {
 *     "enabled": true,
 *     "host": "127.0.0.1",
 *     "port": 6379
 *   }
 * })
 */
function Cache (options) {
  contract.check(options, {
    directory: [ { validator: 'required'}, { validator:'type', args: ['object']}],
    redis: [ { validator: 'required'}, { validator:'type', args: ['object']}]
    // type: [{validator: 'required'}, {validator: 'custom', args:[function x() {
    //   if (options.type === 'directory' && !options.path) return false
    //   if (options.type === 'redis' && !options.host) return false
    //   if (options.type === 'redis' && !options.port) return false
    //   return true
    // }]}]
  })

  this.options = options
  this.cacheHandlers = {}

  this.enabled = options.directory.enabled || options.redis.enabled

  // get the first cache type from the options with { enabled: true }
  this.type = _.findKey(options, (option) => { return option.enabled })

  switch (this.type) {
    case 'directory':
      this.cacheHandler = this.createFileCache(options.directory, options.ttl)
      break
    case 'redis':
      this.cacheHandler = this.createRedisCache(options.redis, options.ttl)
      break
    default:
      this.cacheHandler = this.createFileCache(options.directory, options.ttl)
  }
}

/**
 * Get an item from the cache
 * @param {String} key - the key used to reference the item in the cache
 * @returns {Promise.<Stream, Error>} A promise that returns a Stream if the key exists,
 *     or an Error if it does not exist
 */
Cache.prototype.get = function (key) {
  return this.cacheHandler.get(key)
}

/**
 * Add an item to the cache
 * @param {String} key - the key used to reference the item in the cache
 * @param {Buffer|Stream|String} data - the data to store in the cache
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
Cache.prototype.set = function (key, data) {
  return this.cacheHandler.set(key, data)
}

/**
 * Instantiates a FileCache and adds it to the set of CacheHandlers
 * @param {object} options - the options used to create a FileCache instance, specifically `path` which determines where cached data will be stored
 * @param {Number} ttl - the time in seconds after which a cached item should be considered stale
 * @returns {FileCache}
 */
Cache.prototype.createFileCache = function (options, ttl) {
  options.ttl = ttl
  var handler = new FileCache(options)
  this.cacheHandlers.directory = handler

  return handler
}

/**
 * Instantiates a RedisCache and adds it to the set of CacheHandlers
 * @param {object} options - the options used to create a RedisCache instance, specifically `host` and `port` for connecting to a Redis server
 * @param {Number} ttl - the time in seconds after which Redis should expire a cached item
 * @returns {RedisCache}
 */
Cache.prototype.createRedisCache = function (options, ttl) {
  options.ttl = ttl
  var handler = new RedisCache(options)

  handler.on('ready', () => { // when we are connected
    if (this.cacheHandler.constructor.name === 'FileCache') {
      this.cacheHandler = this.cacheHandlers.redis
    }

    log.warn('REDIS connected')
  })

  handler.on('end', () => { // should fire only on graceful dc
    log.warn('REDIS disconnecting')
  })

  handler.on('reconnecting', function (attempt) { // every attempt
    log.warn('REDIS reconnecting, attempt #' + attempt.attempt)
  })

  handler.on('fail', (cmd, key, data) => {
    log.warn('REDIS connection failed')
    log.warn('Falling back to filesystem caching at ' + this.options.directory.path)

    if (!this.cacheHandlers.directory) {
      this.createFileCache(this.options.directory, this.options.ttl)
    }

    this.cacheHandler = this.cacheHandlers.directory

    if (cmd === 'set') return this.set(key, data)
  })

  this.cacheHandlers.redis = handler

  return handler
}

/**
 *
 */
module.exports = function (options) {
  return new Cache(options || { directory: { enabled: true, path: './cache' }, redis: { enabled: false } } )
}