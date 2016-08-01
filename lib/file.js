var fs = require('fs')
var mkdirp = require('mkdirp')
var path = require('path')
var Stream = require('stream')
var streamifier = require('streamifier')

/**
 * Creates a new FileCache instance
 * @constructor
 * @classdesc This is a description of the FileCache.
 * @param {object} options - the options used to instantiate a FileCache handler
 */
function FileCache (options) {
  this.directory = options.path
  this.extension = options.extension ? '.' + options.extension : ''
  this.ttl = options.ttl || 3600

  this.encoding = 'utf-8'

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
FileCache.prototype.get = function (key) {
  return new Promise((resolve, reject) => {
    var cachePath = path.resolve(path.join(this.directory, key + this.extension))

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
FileCache.prototype.set = function (key, data) {
  return new Promise((resolve, reject) => {
    var cachePath = path.resolve(path.join(this.directory, key + this.extension))

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
 *
 */
module.exports = function (options) {
  return new FileCache(options)
}
