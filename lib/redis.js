'use strict'

const _ = require('underscore')
const EventEmitter = require('events')
const Readable = require('stream').Readable
const redis = require('ioredis')
const noderedis = require('redis')
const redisRStream = require('redis-rstream')
const redisWStream = require('redis-wstream')
const Stream = require('stream')
const streamifier = require('streamifier')
const util = require('util')

// replace the SCAN methods for any node_redis
require('node-redis-streamify')(noderedis)

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
    const maxRetryTime = 10240
    const maxAttempts = 10

    var attemptNumber = self.isClustered ? attempt : attempt.attempt
    var currentRetryTime = baseRetryTime * attemptNumber

    if (currentRetryTime > maxRetryTime) {
      self.onFailure()
      return new Error('Exceeded maximum connection time')
    }

    if (++self.attempts > maxAttempts) {
      self.onFailure()
      return new Error('Exceeded maximum number of reconnection attempts - Redis appears unstable')
    }

    return currentRetryTime
  }

  if (options.cluster) {
    var clusterOptions = {
      clusterRetryStrategy: retryStrategy,
      scaleReads: options.scaleReads || 'master'
    }

    clusterOptions.redisOptions = {
      retryStrategy: retryStrategy,
      lazyConnect: false
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
    redisClient = noderedis.createClient(options.port, options.host, { detect_buffers: true, retryStrategy })
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
    this.attempts = 0
    this.emit('ready')
  })

  // reconnecting: every attempt
  redisClient.on('reconnecting', (attempt) => {
    var attemptNumber = (typeof attempt !== 'undefined') ? attempt : null
    this.emit('reconnecting', this.isClustered ? attemptNumber : attemptNumber.attempt)
  })

  redisClient.on('+node', (node) => {
    this.emit('message', 'Node ' + node.options.key + ' connected')
  })

  redisClient.on('-node', (node) => {
    this.emit('message', 'Node ' + node.options.key + ' disconnected')
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
    if ((this.redisClient.status && this.redisClient.status !== 'ready') || (this.redisClient.hasOwnProperty('ready') && this.redisClient.ready !== true)) {
      this.emit('fail', 'get', key)
      return reject(new Error('The specified key does not exist'))
    }

    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        if (this.isClustered) {
          this.redisClient.getBuffer(key, (err, res) => {
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
  if ((this.redisClient.status && this.redisClient.status !== 'ready') || (this.redisClient.hasOwnProperty('ready') && this.redisClient.ready !== true)) {
    this.emit('fail', 'set', key, data)
    return
  }

  return new Promise((resolve, reject) => {
    if (this.isClustered) {
      if (data.constructor.name === 'PassThrough') {
        var buffers = []

        data.on('data', (chunk) => {
          buffers.push(chunk)
        })

        data.on('end', () => {
          var buffer = Buffer.concat(buffers)

          this.setData(key, buffer).then(() => {
            return resolve('')
          })
        })
      } else {
        this.setData(key, data).then(() => {
          return resolve('')
        })
      }
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
        return reject(err)
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

RedisCache.prototype.setData = function (key, data) {
  return new Promise((resolve, reject) => {
    this.redisClient.set(key, data, (err, res) => {
      if (err) throw (err && err.message) ? err : new Error(err)

      if (this.ttl) {
        this.redisClient.expire(key, this.ttl)
      }

      return resolve('')
    })
  })
}

/**
 * @param {String} match
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
RedisCache.prototype.flush = function (matchPattern) {
  if ((this.redisClient.status && this.redisClient.status !== 'ready') || !this.redisClient.ready) {
    this.emit('fail', 'flush', matchPattern)
  }

  return new Promise((resolve, reject) => {
    try {
      var keys = []

      if (this.redisClient.scanStream) {
        var stream = this.redisClient.scanStream({ match: matchPattern || '' })

        stream.on('data', (resultKeys) => {
          resultKeys.forEach((key) => { keys.push(key) })
        })

        stream.on('end', () => {
          this.deleteKeys(keys).then(() => {
            return resolve('')
          })
        })
      } else {
        var scan = this.redisClient.streamified('SCAN')

        scan(matchPattern || '*').on('data', (data) => {
          keys.push(data)
        }).on('error', (err) => {
          return reject(err)
        }).on('end', () => {
          this.deleteKeys(keys).then(() => {
            return resolve('')
          })
        })
      }
    } catch (err) {
      return reject(err)
    }
  })
}

RedisCache.prototype.deleteKeys = function (keys) {
  return new Promise((resolve, reject) => {
    if (keys.length > 0) {
      var i = 0

      _.each(keys, (key) => {
        this.redisClient.del(key, (err, result) => {
          if (++i === keys.length) {
            return resolve('')
          }
        })
      })
    } else {
      return resolve('')
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
