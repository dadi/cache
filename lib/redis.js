'use strict'

const debug = require('debug')('cache:redis')
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
  this.ready = false

  EventEmitter.call(this)
}

util.inherits(RedisCache, EventEmitter)

RedisCache.prototype.initialise = function initialise (options) {
  var redisClient
  const self = this
  this.attempts = 0
  this.isClustered = options.cluster

  function retryStrategy (attempt) {
    const baseRetryTime = 1024
    const maxRetryTime = 4096
    const maxAttempts = 5

    var attemptNumber = self.isClustered ? attempt : attempt.attempt
    var currentRetryTime = baseRetryTime * attemptNumber

    debug('retry #%s %ss', attemptNumber, currentRetryTime)

    if (currentRetryTime > maxRetryTime) {
      // self.onFailure()
      self.emit('end')

      // self.redisClient.quit()

      return
      // TODO: fix retryStrategy
      // return new Error('Exceeded maximum connection time')
    }

    if (++self.attempts > maxAttempts) {
      self.onFailure()
      self.emit('end')
      return undefined
      // TODO: fix retryStrategy
      // return new Error('Exceeded maximum number of reconnection attempts - Redis appears unstable')
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
    console.log(' > CLIENT ERR')
    if (err.lastNodeError) {
      if (err.lastNodeError.message === 'ERR This instance has cluster support disabled') {
        throw err
      } else if (err.lastNodeError.message === 'Node is disconnected') {
        this.emit('fail')
      }
    } else {
      console.log('---')
      console.log(err)
      console.log('---')
    }
  })

  // end: should fire only on graceful dc
  redisClient.on('end', () => {
    console.log('END')
    // TODO: fix retryStrategy
    this.emit('fail')
    // redisClient.end(false)
  })

  // ready: when we are connected
  redisClient.on('ready', () => {
    this.attempts = 0
    this.ready = true
    this.emit('ready')
  })

  // reconnecting: every attempt
  redisClient.on('reconnecting', (attempt) => {
    console.log('RECONNECTING')
    var attemptNumber = (typeof attempt !== 'undefined') ? attempt : null
    this.emit('reconnecting', this.isClustered ? attemptNumber : attemptNumber.attempt)
    this.emit('message', 'reconnect attempt #' + this.isClustered ? attemptNumber : attemptNumber.attempt)
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
RedisCache.prototype.get = function get (key, options) {
  debug('GET %s', key)

  return new Promise((resolve, reject) => {
    this.redisClient.exists(key, (err, exists) => {
      if (exists > 0) {
        if (this.isClustered) {
          this.redisClient.getBuffer(key, (err, res) => {
            if (err) throw (err && err.message) ? err : new Error(err)
            const stream = new Readable()
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

/**
 * Get any metadata stored for a key
 * @param {String} key - the key used to reference the item in the cache
 * @returns {Promise.<Object>} A promise that returns an object if there is metadata
 *     for the given key, or null otherwise
 */
RedisCache.prototype.getMetadata = function getMetadata (key) {
  let metadataKey = this.getMetadataKey(key)

  return new Promise((resolve, reject) => {
    this.redisClient.exists(metadataKey, (err, exists) => {
      if (exists === 0) {
        return resolve(null)
      }

      this.redisClient.get(metadataKey, (err, res) => {
        if (err) {
          if (err.message) {
            throw err
          }

          throw new Error(err)
        }

        try {
          let parsed = JSON.parse(res)

          resolve(parsed)
        } catch (err) {
          reject(err)
        }
      })      
    })
  })  
}

/**
 * Computes a key to use for the metadata associated with
 * a key
 * @param  {String} key
 * @return {String}
 */
RedisCache.prototype.getMetadataKey = function (key) {
  return `___${key}___`
}

/**
 *
 */
RedisCache.prototype.set = function set (key, data, options) {
  debug('SET %s %o', key, options)

  return new Promise((resolve, reject) => {
    if (this.isClustered) {
      if (typeof data.on === 'function') {
        var buffers = []

        data.on('data', (chunk) => {
          buffers.push(chunk)
        })

        data.on('end', () => {
          var buffer = Buffer.concat(buffers)

          this.setData(key, buffer, options.ttl).then(() => {
            return resolve('')
          })
        })
      } else {
        this.setData(key, data, options.ttl).then(() => {
          return resolve('')
        })
      }
    } else {
      var stream
      var redisWriteStream = redisWStream(this.redisClient, key)

      redisWriteStream.on('finish', () => {
        if (options.ttl || this.ttl) {
          this.redisClient.expire(key, options.ttl || this.ttl)
        }

        return resolve('')
      })

      redisWriteStream.on('error', (err) => {
        if (err.code && err.code === 'NR_CLOSED') {
          // this.emit('fail', 'set', key, data)
          return resolve()
        } else {
          return reject(err)
        }
      })

      // create a stream from the data if it is a String or Buffer
      if (data instanceof Buffer || typeof data === 'string') {
        stream = streamifier.createReadStream(data)
      } else if (data instanceof Stream) {
        stream = data
      }

      stream.pipe(redisWriteStream)
    }
  }).then(result => {
    if (!options.metadata) {
      return result
    }

    return this.setData(
      this.getMetadataKey(key),
      JSON.stringify(options.metadata),
      options.ttl
    ).then(() => result)
  })
}

RedisCache.prototype.setData = function (key, data, ttl) {
  return new Promise((resolve, reject) => {
    this.redisClient.set(key, data, (err, res) => {
      if (err) throw (err && err.message) ? err : new Error(err)

      if (ttl || this.ttl) {
        this.redisClient.expire(key, ttl || this.ttl)
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
  debug('FLUSH %s', matchPattern)

  return new Promise((resolve, reject) => {
    try {
      let keys = []

      if (this.redisClient.scanStream) {
        let stream = this.redisClient.scanStream({ match: matchPattern || '' })

        stream.on('data', resultKeys => {
          resultKeys.forEach(key => {
            keys.push(key)
            keys.push(this.getMetadataKey(key))
          })
        })

        stream.on('end', () => {
          this.deleteKeys(keys).then(() => {
            return resolve('')
          })
        })
      } else {
        let scan = this.redisClient.streamified('SCAN')

        scan(matchPattern || '*').on('data', data => {
          keys.push(data)
          keys.push(this.getMetadataKey(data))
        }).on('error', err => {
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
      let i = 0

      keys.forEach(key => {
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

RedisCache.prototype.onFailure = function onFailure () {
  const redisRetryTime = 1000 * 60 * 1

  this.emit('fail')

  // TODO: fix retryStrategy
  // create an event to try redis again
  // setTimeout(() => {
  //   this.emit('message', 'REDIS attempting reconnection')
  //   this.redisClient = this.initialise(this.options)
  // }, redisRetryTime)
}

module.exports = function (options) {
  return new RedisCache(options)
}
