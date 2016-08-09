var _ = require('underscore')
var fs = require('fs')
var mkdirp = require('mkdirp')
var path = require('path')
var Stream = require('stream')
var streamifier = require('streamifier')
var recursive = require('recursive-readdir')

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
  this.cleanseInterval = options.cleanseInterval || 300
  this.cleanseEnabled = options.cleanseEnabled || false
  this.encoding = 'utf-8'

  if (this.cleanseEnabled) {
    this.enableCacheCleansing()
  }

  mkdirp(this.directory, (err, made) => {
    // if (err) log.error({module: 'cache'}, err)
    // if (made) log.info({module: 'cache'}, 'Created cache directory ' + made)
  })
}

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
 * enableCacheCleansing - sets up and manages the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.enableCacheCleansing = function enableCacheCleansing() {
  var timeoutTrigger = () => {
    this.cleanseTimeout = setTimeout(() => {
      this.cleanseEnabled && this.cleanseCache(this.directory, timeoutTrigger)
    }, this.cleanseInterval * 1000)
  }

  timeoutTrigger()
}

/**
 * disableCacheCleansing - stops and cleans up the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.disableCacheCleansing = function disableCacheCleansing() {
  this.cleanseEnabled = false
  if (this.cleanseTimeout) {
    clearTimeout(this.cleanseTimeout)
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
      throw recursiveErr
    }

    var count = files.length
    var idx = 0

    files.forEach((file) => {
      fs.stat(file, (statErr, stats) => {
        if (statErr) {
          throw statErr
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
