var _ = require('underscore')
var contract = require('dbc')
var EventEmitter = require('events')
var path = require('path')
var FileCache = require('./file')
var RedisCache = require('./redis')
var util = require('util')

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
 *     "path": "./cache/",
 *     "extension": "json"
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
    directory: [
      { validator: 'required' },
      { validator: 'type', args: ['object'] }
    ],
    redis: [
      { validator: 'required' },
      { validator: 'type', args: ['object'] }
    ]
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

util.inherits(Cache, EventEmitter)

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
 * Flush the cache
 * @param {String} path
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
Cache.prototype.flush = function (path) {
  return this.cacheHandler.flush(path)
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

    this.emit('message', 'REDIS connected')
    this.emit('ready')
  })

  handler.on('end', () => { // should fire only on graceful dc
    this.emit('message', 'REDIS disconnecting')
  })

  handler.on('reconnecting', function (attempt) { // every attempt
    this.emit('message', 'REDIS reconnecting, attempt #' + attempt)
  })

  handler.on('error', function (message) {
    this.emit('error', message)
  })

  handler.on('fail', (cmd, key, data) => {
    this.emit('message', 'REDIS connection failed. Falling back to filesystem caching at ' + path.resolve(this.options.directory.path))

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
