'use strict'

var _ = require('underscore')
var EventEmitter = require('events')
var fs = require('fs')
var path = require('path')
var mkdirp = require('mkdirp')
var path = require('path')
var Stream = require('stream')
var streamifier = require('streamifier')
var recursive = require('recursive-readdir')
var util = require('util')

/**
 * Creates a new FileCache instance
 * @constructor
 * @classdesc This is a description of the FileCache.
 * @param {object} options - the options used to instantiate a FileCache handler
 */
function FileCache (options) {
  this.directory = options.path
  this.extension = options.extension ? '.' + options.extension : ''
  this.directoryChunkSize = (options.directoryChunkSize && _.isFinite(options.directoryChunkSize)) ? options.directoryChunkSize : 0
  this.ttl = options.ttl || 3600
  this.autoFlushInterval = options.autoFlushInterval || 300
  this.autoFlush = options.autoFlush || false
  this.encoding = 'utf-8'

  if (this.autoFlush) {
    this.enableAutoFlush()
  }

  fs.stat(this.directory, (err) => {
    if (err) {
      mkdirp(this.directory, (err, made) => {
        if (err) console.log(err)
        if (made) console.log('Created cache directory', made)
      })
    }
  })
}

util.inherits(FileCache, EventEmitter)

/**
 * @param {String} key - the key to retrieve from cache
 * @returns {Promise.<Stream, Error>} A promise that returns a Stream if the key exists,
 *     or an Error if it does not exist
 */
FileCache.prototype.get = function get(key) {
  return new Promise((resolve, reject) => {
    var cachePath = this.getCachePath(key)

    fs.stat(cachePath, (err, stats) => {
      if (err) {
        return reject(new Error('The specified key does not exist'))
      }

      var lastModified = stats && stats.mtime && stats.mtime.valueOf()

      if (this.ttl && lastModified && (Date.now() - lastModified) / 1000 <= this.ttl) {
        var stream = fs.createReadStream(cachePath)
        return resolve(stream)
      }
      else {
        return reject(new Error('The specified key has expired'))
      }
    })
  })
}

/**
 * @param {String} key - the key to store the data against
 * @param {String|Buffer|Stream} data - the data to cache, as a String, Buffer or Stream
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.set = function set(key, data) {
  return new Promise((resolve, reject) => {
    var cachePath = this.getCachePath(key)

    // open a stream for writing the data
    var cacheFile = fs.createWriteStream(cachePath, { flags: 'w', defaultEncoding: this.encoding })

    cacheFile.on('finish', () => {
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

    stream.pipe(cacheFile)
  })
}

/**
 * @param {String} pattern
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.flush = function (pattern) {
  return new Promise((resolve, reject) => {
    const cachePath = path.join(this.directory)

    fs.stat(cachePath, (err, stats) => {
      if (err) {
        return reject('[@dadi/cache - FileCache.flush()] Directory doesn\'t exist: ' + cachePath)
      }

      if (stats.isDirectory()) {
        const files = fs.readdirSync(cachePath)

        if (files.length === 0) {
          return resolve('')
        }

        let i = 0

        files.forEach((filename) => {
          if (new RegExp(pattern).test(filename)) {
            fs.unlinkSync(path.join(cachePath, filename))
          }

          // finished, all files processed
          if (++i === files.length) {
            return resolve('')
          }
        })
      } else {
        fs.unlinkSync(cachePath)
        return resolve('')
      }
    })
  })
}

/**
 * @param  {String} key - the key to store the data against
 * @returns {String}
 */
FileCache.prototype.getCachePath = function getCachePath(key) {
  var folderPath = ''

  // split cache key into chunks to create folders
  if (this.directoryChunkSize > 0) {
    var re = new RegExp('.{1,' + this.directoryChunkSize + '}', 'g')
    folderPath = key.match(re).join('/')
  }

  folderPath = path.resolve(path.join(this.directory, folderPath))

  // ensure this path exists
  try {
    mkdirp.sync(folderPath)
  } catch (err) {
    if (err.code !== 'EEXISTS') throw err
  }

  return path.resolve(path.join(folderPath, key + this.extension))
}

/**
 * enableAutoFlush - sets up and manages the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.enableAutoFlush = function enableAutoFlush() {
  var timeoutTrigger = () => {
    this.autoFlushTimeout = setTimeout(() => {
      this.autoFlush && this.cleanseCache(this.directory, timeoutTrigger)
    }, this.autoFlushInterval * 1000)
  }

  timeoutTrigger()
}

/**
 * disableAutoFlush - stops and cleans up the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.disableAutoFlush = function disableAutoFlush() {
  this.autoFlush = false

  if (this.autoFlushTimeout) {
    clearTimeout(this.autoFlushTimeout)
  }
}

/**
 * cleanseCache - trawls cache files and removes any that have expired
 *
 * @param {String} directory path to cleanse
 * @param {callback} done
 * @returns {void}
 */
FileCache.prototype.cleanseCache = function cleanseCache(dir, done) {
  recursive(dir, (recursiveErr, files) => {
    if (recursiveErr) {
      this.emit('error', recursiveErr)
      return
    }

    var count = files.length
    var idx = 0

    files.forEach((file) => {
      fs.stat(file, (statErr, stats) => {
        if (statErr) {
          this.emit('error', statErr)
          return
        }

        var lastModified = stats && stats.mtime && stats.mtime.valueOf()

        if (lastModified && (Date.now() - lastModified) / 1000 > this.ttl) {
          fs.unlinkSync(file)
        }

        if (++idx === count) {
          done()
        }
      })
    })
  })
}

/**
 * @param  {Object} options
 * @returns {FileCache} new instance of FileCache
 */
module.exports = function (options) {
  return new FileCache(options)
}
