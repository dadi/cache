const contract = require('dbc')
const EventEmitter = require('events')
const merge = require('deepmerge')
const path = require('path')
const FileCache = require('./file')
const RedisCache = require('./redis')
const util = require('util')

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
  this.type = Object.keys(options).filter(cacheHandler => {
    return options[cacheHandler] && options[cacheHandler].enabled
  })[0]

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
Cache.prototype.get = function (key, options) {
  options = options || {}
  return this.cacheHandler.get(key, options)
}

/**
 * Get any metadata stored for a key
 * @param {String} key - the key used to reference the item in the cache
 * @returns {Promise.<Object, Error>} A promise that returns an object if there is metadata
 *     for the given key, or an Error otherwise
 */
Cache.prototype.getMetadata = function (key) {
  return this.cacheHandler.getMetadata(key)
}

/**
 * Add an item to the cache
 * @param {String} key - the key used to reference the item in the cache
 * @param {Buffer|Stream|String} data - the data to store in the cache
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
Cache.prototype.set = function (key, data, options) {
  options = options || {}
  return this.cacheHandler.set(key, data, options)
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
  let handler = new FileCache(Object.assign({}, options, {
    ttl
  }))

  this.cacheHandlers.directory = handler

  this.emit('message', 'FileCache connected')
  this.emit('ready')

  return handler
}

/**
 * Instantiates a RedisCache and adds it to the set of CacheHandlers
 * @param {object} options - the options used to create a RedisCache instance, specifically `host` and `port` for connecting to a Redis server
 * @param {Number} ttl - the time in seconds after which Redis should expire a cached item
 * @returns {RedisCache}
 */
Cache.prototype.createRedisCache = function (options, ttl) {
  let handler = new RedisCache(Object.assign({}, options, {
    ttl
  }))

  handler.on('ready', () => { // when we are connected
    if (this.cacheHandler.constructor.name === 'FileCache') {
      this.cacheHandler = this.cacheHandlers.redis
    }

    this.emit('message', 'REDIS connected')
    this.emit('ready')
  })

  handler.on('end', () => { // should fire only on graceful dc
    this.emit('message', 'REDIS disconnecting')
    this.cacheHandlers.redis = null
  })

  handler.on('reconnecting', function (attempt) { // every attempt
    this.emit('message', 'REDIS reconnecting, attempt #' + attempt)
  })

  handler.on('error', function (err) {
    this.emit('message', err)
  })

  handler.on('fail', (cmd, key, data) => {
    this.emit('message', 'REDIS connection failed. Falling back to filesystem caching at ' + path.resolve(this.options.directory.path))

    if (!this.cacheHandlers.directory) {
      this.createFileCache(this.options.directory, this.options.ttl)
    }

    delete this.cacheHandlers.redis

    this.cacheHandler = this.cacheHandlers.directory

    if (cmd === 'set') {
      return this.set(key, data)
    }

    if (cmd === 'get') {
      return this.get(key)
    }
  })

  this.cacheHandlers.redis = handler

  return handler
}

/**
 *
 */
module.exports = function (options) {
  var defaults = { directory: { enabled: false, path: 'cache' }, redis: { enabled: false } }
  var cacheOptions = merge(defaults, options || {})

  return new Cache(cacheOptions)
}
