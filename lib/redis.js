'use strict'

const _ = require('underscore')
const util = require('util')
const EventEmitter = require('events')
const redis = require('ioredis')
const redisRStream = require('redis-rstream')
const redisWStream = require('redis-wstream')
const Stream = require('stream')
const streamifier = require('streamifier')
const log = require('@dadi/logger')

function RedisCache (options) {
  this.options = options
  this.ttl = options.ttl || 3600
  this.redisClient = this.initialise(options)

  EventEmitter.call(this)
}

util.inherits(RedisCache, EventEmitter)

RedisCache.prototype.initialise = function initialise(options) {
  const self = this
  this.timesConnected = 0

  function retryStrategy(attempts) {
    const baseRetryTime = 1024
    const maxRetryTime = 4096
    const maxConnectedTimes = 3
    const currentRetryTime = baseRetryTime * attempts

    if (currentRetryTime > maxRetryTime) {
      self.onFailure()
      return new Error('Exceeded max retry time')
    }

    if (self.timesConnected > maxConnectedTimes) {
      self.onFailure()
      return new Error('Exceeded max times connected; Redis appears unstable')
    }

    return currentRetryTime
  }

  const redisClient = redis.createClient(options.port, options.host, { retryStrategy })

  // error: doesn't get fired on dc errors
  redisClient.on('error', (err) => {
    log.error(err)
  })

  // end: should fire only on graceful dc
  redisClient.on('end', () => {
    this.emit('end')
  })

  // ready: when we are connected
  redisClient.on('ready', () => {
    this.timesConnected++
    this.emit('ready')
  })

  // reconnecting: every attempt
  redisClient.on('reconnecting', (attempt) => {
    this.emit('reconnecting', attempt)
  })

  return redisClient
}

RedisCache.prototype.get = function get(key) {
  return new Promise((resolve, reject) => {
    if (this.redisClient.status !== 'ready') {
      this.emit('fail')
      return reject(new Error('The specified key does not exist'))
    }

    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        const stream = redisRStream(this.redisClient, key)
        return resolve(stream)
      } else {
        return reject(new Error('The specified key does not exist'))
      }
    })
  })
}

RedisCache.prototype.set = function set(key, data) {
  if (this.redisClient.status !== 'ready') {
    this.emit('fail', 'set', key, data)
  }

  return new Promise((resolve, reject) => {
    const redisWriteStream = redisWStream(this.redisClient, key)

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
 * @param {String} match
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
RedisCache.prototype.flush = function flush(matchPattern) {
  if (this.redisClient.status !== 'ready') {
    this.emit('fail', 'flush', path)
  }

  return new Promise((resolve, reject) => {
    try {
      const keys = []
      const match = matchPattern || ''
      const stream = this.redisClient.scanStream({ match })

      stream.on('data', (resultKeys) => {
        resultKeys.forEach((key) => { keys.push(key) })
      })
      stream.on('end', () => {
        if (keys.length > 0) {
          var i = 0;
          _.each(keys, (key) => {
            this.redisClient.del(key, (err, result) => {
              if (++i === keys.length) return resolve('')
            })
          })
        } else {
          return resolve('')
        }
      })
    } catch (ex) {
      reject(ex)
    }
  })
}

RedisCache.prototype.onFailure = function onFailure() {
  const redisRetryTime = 1000 * 60 * 1

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
