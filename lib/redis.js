var EventEmitter = require('events')
var log = require('@dadi/logger')
var redis = require('redis')
var redisRStream = require('redis-rstream')
var redisWStream = require('redis-wstream')
var Stream = require('stream')
var streamifier = require('streamifier')
var util = require('util')

/**
 * Creates a new RedisCache instance
 * @constructor
 * @classdesc This is a description of the RedisCache.
 * @param {object} options - the options used to instantiate a RedisCache handler
 */
function RedisCache (options) {
  this.options = options
  this.ttl = options.ttl || 3600
  this.redisClient = this.initialise(options)

  EventEmitter.call(this)
}

util.inherits(RedisCache, EventEmitter)

/**
 * @param {String} key - the key to retrieve from cache
 * @returns {Promise.<Stream, Error>} A promise that returns a Stream if the key exists,
 *     or an Error if it does not exist
 */
RedisCache.prototype.get = function (key) {
  return new Promise((resolve, reject) => {
    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        var stream = redisRStream(this.redisClient, key)
        return resolve(stream)
      } else {
        return reject(new Error('The specified key does not exist'))
      }
    })
  })
}

/**
 * @param {String} key - the key to store the data against
 * @param {String|Buffer|Stream} data - the data to cache, as a String, Buffer or Stream
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
RedisCache.prototype.set = function (key, data) {
  return new Promise((resolve, reject) => {
    var redisWriteStream = redisWStream(this.redisClient, key)

    redisWriteStream.on('finish', () => {
      if (this.ttl) {
        this.redisClient.expire(key, this.ttl)
      }

      return resolve('')
    }).on('error', (err) => {
      return reject(err)
    })

    var stream

    // create a stream from the data if it is a String or Buffer
    if (data instanceof Buffer || typeof data === 'string') {
      stream = streamifier.createReadStream(data)
    } else if (data instanceof Stream) {
      stream = data
    }

    stream.pipe(redisWriteStream)
  })
}

/**
 * Initialises a RedisClient using the main configuration settings
 * @returns {RedisClient}
 */
RedisCache.prototype.initialise = function (options) {
  var self = this

  function retryStrategy (options) {
    var baseRetryTime = 1024
    var maxRetryTime = 4096
    var maxConnectedTimes = 3

    var currentRetryTime = baseRetryTime * options.attempt

    if (currentRetryTime > maxRetryTime) {
      self.onFailure()
      return new Error('Exceeded max retry time')
    }

    if (options.times_connected > maxConnectedTimes) {
      self.onFailure()
      return new Error('Exceeded max times connected; Redis appears unstable')
    }

    return currentRetryTime
  }

  var redisClient = redis.createClient(options.port, options.host, {detect_buffers: true, retry_strategy: retryStrategy})

  redisClient.on('error', function (err) { // Doesn't get fired on dc errors
    log.error(err)
  })

  redisClient.on('end', () => { // should fire only on graceful dc
    this.emit('end')
  })

  redisClient.on('ready', () => { // when we are connected
    this.emit('ready')
  })

  redisClient.on('reconnecting', (attempt) => { // every attempt
    this.emit('reconnecting', attempt)
  })

  return redisClient
}

RedisCache.prototype.onFailure = function () {
  var redisRetryTime = 1000 * 60 * 1

  this.emit('fail')

  // create an event to try redis again
  setTimeout(() => {
    log.warn('REDIS attempting reconnection')
    this.redisClient = this.initialise(this.options)
  }, redisRetryTime)
}

module.exports = function (options) {
  return new RedisCache(options)
}
