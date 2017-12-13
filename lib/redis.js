'use strict'

const _ = require('underscore')
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
const cluster = require('cluster')

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

RedisCache.prototype.initialise = function initialise(options) {
  var redisClient
  const self = this
  this.attempts = 0
  this.isClustered = options.cluster

  function retryStrategy(attempt) {
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
    //redisClient.end(false)
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
RedisCache.prototype.get = function get(key, options) {
  debug('GET %s', key)

  return new Promise((resolve, reject) => {
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

/**
 *
 */
RedisCache.prototype.set = function set(key, data, options) {
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
  return new Promise((resolve, reject) => {
    if (cluster.isMaster) {
      // If we're running as the master, then we want to fork the process once. We will send the
      // options as well as matchPattern to the slave process and wait for a response.
      const slave = cluster.fork()
      slave.on('message', (msg) => {
        const result = JSON.parse(msg)
        if (result.success) resolve()
        else reject(result.error)
      })
      slave.send(JSON.stringify({
        options: this.options,
        matchPattern: matchPattern
      }))
    } else {
      // If we're running as the slave, then we'll have been called by SlaveFlushCache() below.
      // The below logic is the original flush logic, which clears the flush.
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

  // TODO: fix retryStrategy
  // create an event to try redis again
  // setTimeout(() => {
  //   this.emit('message', 'REDIS attempting reconnection')
  //   this.redisClient = this.initialise(this.options)
  // }, redisRetryTime)
}

// This function will run once cluster.fork() is ran, and waits for a message
// from the master process (in RedisCache.prototype.flush). The message contains
// the options used to initialise the redis client, as well as the matchPattern
// to pass back to RedisCache.prototype.flush. Once complete, we send a message
// back to the master process which will then complete it's promise.
function SlaveFlushCache() {
  debug('[' + process.pid + ']', 'SLAVE INIT')

  process.on('message', (msg) => {
    debug('[' + process.pid + ']', 'SLAVE MSG', msg)
    const args = JSON.parse(msg)
    const cache = new RedisCache(args.options)
    const result = {}
    cache
      .flush(args.matchPattern)
      .then(() => {
        debug('[' + process.pid + ']', 'FLUSH DONE')
        process.send(JSON.stringify({
          success: true
        }))
        process.exit()
      })
      .catch((err) => {
        debug('[' + process.pid + ']', 'FLUSH ERROR', err)
        process.send(JSON.stringify({
          success: false,
          error: err
        }))
        process.exit()
      })
  })
}

// Check with each execution whether or not we're a slave process
// and if we are, call a function that kicks off the flush process
if (!cluster.isMaster) {
  SlaveFlushCache()
}

module.exports = function (options) {
  return new RedisCache(options)
}
