'use strict'

const _ = require('underscore')
const EventEmitter = require('events')
const Readable = require('stream').Readable
const redis = require('ioredis')
const redisRStream = require('redis-rstream')
const redisWStream = require('redis-wstream')
const Stream = require('stream')
const streamifier = require('streamifier')
const util = require('util')

function RedisCache (options) {
  this.options = options
  this.ttl = options.ttl || 3600
  this.redisClient = this.initialise(options)

  EventEmitter.call(this)
}

util.inherits(RedisCache, EventEmitter)

RedisCache.prototype.initialise = function initialise(options) {
  var redisClient
  const self = this
  this.attempts = 0
  this.isClustered = options.cluster

  function retryStrategy(attempt) {
    const baseRetryTime = 1024
    const maxRetryTime = 4096
    const maxAttempts = 3

    var currentRetryTime = baseRetryTime * attempt

    if (currentRetryTime > maxRetryTime) {
      self.onFailure()
      return new Error('Exceeded maximum connection time')
    }

    if (++self.attempts > maxAttempts) {
      self.onFailure()
      return new Error('Exceeded maximum number of reconnection attempts - Redis appears unstable')
    }

    return attempt
  }

  if (options.cluster) {
    var clusterOptions = {
      clusterRetryStrategy: retryStrategy,
      scaleReads: options.scaleReads || 'master'
    }

    clusterOptions.redisOptions = {
      retryStrategy
    }

    if (!options.hosts) {
      options.hosts = [
        {
          host: options.host,
          port: options.port
        }
      ]
    }

    redisClient = new redis.Cluster(options.hosts, clusterOptions)
  } else {
    redisClient = redis.createClient(options.port, options.host, { retryStrategy })
  }

  // error: doesn't get fired on dc errors
  redisClient.on('error', (err) => {
    if (err.lastNodeError) {
      if (err.lastNodeError.message === 'ERR This instance has cluster support disabled') {
        throw err
      } else if (err.lastNodeError.message === 'Node is disconnected') {
        this.emit('fail')
      }
    }
  })

  // end: should fire only on graceful dc
  redisClient.on('end', () => {
    this.emit('end')
  })

  // ready: when we are connected
  redisClient.on('ready', () => {
    this.emit('ready')
  })

  // reconnecting: every attempt
  redisClient.on('reconnecting', (attempt) => {
    this.emit('reconnecting', typeof attempt !== 'undefined' ? attempt : null)
  })

  return redisClient
}

/**
 * @param {String} key - the key to retrieve from cache
 * @returns {Promise.<Stream, Error>} A promise that returns a Stream if the key exists,
 *     or an Error if it does not exist
 */
RedisCache.prototype.get = function get(key) {
  return new Promise((resolve, reject) => {
    if (this.redisClient.status !== 'ready') {
      this.emit('fail')
      return reject(new Error('The specified key does not exist'))
    }

    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        if (this.isClustered) {
          this.redisClient.get(key, (err, res) => {
            if (err) throw (err && err.message) ? err : new Error(err)
            const stream = new Readable
            stream.push(res)
            stream.push(null) // eof
            return resolve(stream)
          })
        } else {
          const stream = redisRStream(this.redisClient, key)
          return resolve(stream)
        }
      } else {
        return reject(new Error('The specified key does not exist'))
      }
    })
  })
}

RedisCache.prototype.set = function set(key, data) {
  if (this.redisClient.status !== 'ready') {
    this.emit('fail', 'set', key, data)
    return
  }

  return new Promise((resolve, reject) => {
    if (this.isClustered) {
      this.redisClient.set(key, data, (err, res) => {
        if (err) throw (err && err.message) ? err : new Error(err)

        if (this.ttl) {
          this.redisClient.expire(key, this.ttl)
        }

        return resolve('')
      })
    } else {
      var stream
      const redisWriteStream = redisWStream(this.redisClient, key)

      redisWriteStream.on('finish', () => {
        if (this.ttl) {
          this.redisClient.expire(key, this.ttl)
        }

        return resolve('')
      }).on('error', (err) => {
        this.emit('fail', 'set', key, data)
        // return reject(err)
      })

      // create a stream from the data if it is a String or Buffer
      if (data instanceof Buffer || typeof data === 'string') {
        stream = streamifier.createReadStream(data)
      } else if (data instanceof Stream) {
        stream = data
      }

      stream.pipe(redisWriteStream)
    }
  })
}

/**
 * @param {String} match
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
RedisCache.prototype.flush = function (matchPattern) {
  if (this.redisClient.status !== 'ready') {
    this.emit('fail', 'flush', path)
  }

  return new Promise((resolve, reject) => {
    try {
      const keys = []
      const stream = this.redisClient.scanStream({ match: matchPattern || '' })

      stream.on('data', (resultKeys) => {
        resultKeys.forEach((key) => { keys.push(key) })
      })

      stream.on('end', () => {
        if (keys.length > 0) {
          var i = 0

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
    this.emit('message', 'REDIS attempting reconnection')
    this.redisClient = this.initialise(this.options)
  }, redisRetryTime)
}

module.exports = function (options) {
  return new RedisCache(options)
}
