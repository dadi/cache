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
  var redisClient
  const self = this
  this.timesConnected = 0
  this.isClustered = options.cluster

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

  if (options.cluster) {
    redisClient = new redis.Cluster(options.hosts, {
      redisOptions: {
        detect_buffers: true,
        retry_strategy: retryStrategy
      }
    })
  } else {
    redisClient = redis.createClient(options.port, options.host, {
      detect_buffers: true,
      retry_strategy: retryStrategy
    })
  }

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
    this.emit('reconnecting', typeof attempt !== 'undefined' ? attempt : null)
  })

  return redisClient
}

RedisCache.prototype.get = function get(key) {
  return new Promise((resolve, reject) => {
    const isReady = this.redisClient.status === 'ready'

    if (!isReady && !this.redisClient.connected) {
      this.emit('fail')
      return reject(new Error('The specified key does not exist'))
    }

    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        if (this.isClustered) {
          this.redisClient.get(key, (err, res) => {
            if (err) throw (err && err.message) ? err : new Error(err)
            resolve(res)
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
  const isReady = this.redisClient.status === 'ready'

  if (!isReady && !this.redisClient.connected) {
    this.emit('fail', 'set', key, data)
  }

  return new Promise((resolve, reject) => {
    if (this.isClustered) {
      this.redisClient.set(key, data, (err, res) => {
        if (err) throw (err && err.message) ? err : new Error(err)
        if (this.ttl) {
          this.redisClient.expire(key, this.ttl)
        }
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
