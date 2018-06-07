'use strict'

const debug = require('debug')('cache:file')
const deleteEmpty = require('remove-empty-directories')
const EventEmitter = require('events')
const fs = require('fs')
const Loki = require('lokijs')
const path = require('path')
const mkdirp = require('mkdirp')
const Stream = require('stream')
const streamifier = require('streamifier')
const recursive = require('recursive-readdir')
const util = require('util')

/**
 * Creates a new FileCache instance
 * @constructor
 * @classdesc This is a description of the FileCache.
 * @param {object} options - the options used to instantiate a FileCache handler
 */
function FileCache (options) {
  this.directory = options.path
  this.extension = options.extension ? '.' + options.extension : ''
  this.directoryChunkSize = (options.directoryChunkSize && Number.isFinite(options.directoryChunkSize)) ? options.directoryChunkSize : 0
  this.ttl = options.ttl || 3600
  this.autoFlushInterval = options.autoFlushInterval || 300
  this.autoFlush = options.autoFlush || false

  if (this.autoFlush) {
    this.enableAutoFlush()
  }

  this.db = this.startDatabase()

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
FileCache.prototype.get = function get (key, options) {
  debug('GET %s %o', key, options)

  return new Promise((resolve, reject) => {
    let cachePath = this.getCachePath(key, options)

    fs.stat(cachePath, (err, stats) => {
      if (err) {
        return reject(new Error('The specified key does not exist'))
      }

      let lastModified = stats && stats.mtime && stats.mtime.valueOf()

      let ttl = options.ttl || this.ttl

      if (ttl && lastModified && (Date.now() - lastModified) / 1000 <= ttl) {
        let stream = fs.createReadStream(cachePath)
        return resolve(stream)
      } else {
        return reject(new Error('The specified key has expired'))
      }
    })
  })
}

/**
 * Gets a block of metadata for a given key, parsing it as JSON. Waits for the
 * internal database to be initialised and become available.
 *
 * @param  {String} key - cache key
 * @return {Promise.<Object, Error>} A promise that returns the metadata block if it exists,
 *    or an Error otherwise.
 */
FileCache.prototype.getMetadata = function getMetadata (key) {
  return this.db.then(db => {
    let match = db.findOne({ $key: key })

    if (match && match.$dadiCache) {
      return match.$dadiCache
    }

    return null
  })
}

/**
 * @param {String} key - the key to store the data against
 * @param {String|Buffer|Stream} data - the data to cache, as a String, Buffer or Stream
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.set = function set (key, data, options) {
  debug('SET %s %o', key, options)

  return new Promise((resolve, reject) => {
    let cachePath = this.getCachePath(key, options)

    // open a stream for writing the data
    let cacheFile = fs.createWriteStream(cachePath, { flags: 'w' })

    cacheFile.on('finish', () => {
      return resolve('')
    }).on('error', (err) => {
      return reject(err)
    })

    let stream

    // create a stream from the data if it is a String or Buffer
    if (data instanceof Buffer || typeof data === 'string') {
      stream = streamifier.createReadStream(data)
    } else if (data instanceof Stream) {
      stream = data
    }

    stream.pipe(cacheFile)
  }).then(result => {
    if (!options.metadata) {
      return result
    }

    return this.setMetadata(key, options.metadata).then(() => result)
  })
}

/**
 * Saves a block of metadata for a given key. Waits for the internal database
 * to be initialised and become available.
 *
 * @param {String} key - cache key
 * @param {Object} data - metadata payload
 * @returns {Promise.<Array>} A promise that returns the inserted data
 */
FileCache.prototype.setMetadata = function setMetadata (key, data) {
  return this.db.then(db => {
    db.findAndRemove({ $key: key })

    let insert = db.insert({
      $dadiCache: data,
      $key: key
    })

    return insert
  })
}

/**
 * Removes cache files matching a specified pattern and removes empty directories when finished.
 *
 * @param {String} pattern
 * @returns {Promise.<String, Error>} A promise that returns an empty String if successful, otherwise an Error
 */
FileCache.prototype.flush = function (pattern) {
  return new Promise((resolve, reject) => {
    let cachePath = path.resolve(this.directory)
    let re = new RegExp(pattern)

    recursive(cachePath, (recursiveErr, files) => {
      if (recursiveErr) {
        return reject(recursiveErr)
      }

      if (files.length === 0) {
        return resolve('')
      }

      let matchingFiles = files.filter(file => {
        return re.test(file)
      })
      let idx = 0

      matchingFiles.forEach(file => {
        let filepath = path.resolve(file)

        fs.unlink(filepath, () => {
          if (++idx === matchingFiles.length) {
            deleteEmpty(cachePath)

            return resolve('')
          }
        })
      })
    })

    // Remove metadata.
    this.db.then(db => {
      db.findAndRemove({ $key: { $regex: re } })
    })
  })
}

/**
 * @param  {String} key - the key to store the data against
 * @returns {String}
 */
FileCache.prototype.getCachePath = function getCachePath (key, options) {
  let folderPath = ''

  // split cache key into chunks to create folders
  if (this.directoryChunkSize > 0) {
    let re = new RegExp('.{1,' + this.directoryChunkSize + '}', 'g')
    folderPath = key.match(re).join('/')
  }

  folderPath = path.resolve(path.join(this.directory, folderPath))

  // ensure this path exists
  try {
    mkdirp.sync(folderPath)
  } catch (err) {
    if (err.code !== 'EEXISTS') throw err
  }

  let extension

  if (options.directory && options.directory.extension) {
    extension = options.directory.extension[0] === '.' ? options.directory.extension : '.' + options.directory.extension
  } else {
    extension = this.extension
  }

  return path.resolve(path.join(folderPath, key + extension))
}

/**
 * Sets up and manages the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.enableAutoFlush = function enableAutoFlush () {
  let timeoutTrigger = () => {
    this.autoFlushTimeout = setTimeout(() => {
      this.autoFlush && this.cleanseCache(this.directory, timeoutTrigger)
    }, this.autoFlushInterval * 1000)
  }

  timeoutTrigger()
}

/**
 * Stops and cleans up the timeout for cache cleansing
 *
 * @returns {void}
 */
FileCache.prototype.disableAutoFlush = function disableAutoFlush () {
  this.autoFlush = false

  if (this.autoFlushTimeout) {
    clearTimeout(this.autoFlushTimeout)
  }
}

/**
 * Trawls a cache directory and removes any cache files that have expired
 * and removes empty directories when finished.
 *
 * @param {String} directory path to cleanse
 * @param {callback} done
 * @returns {void}
 */
FileCache.prototype.cleanseCache = function cleanseCache (dir, done) {
  recursive(dir, (recursiveErr, files) => {
    if (recursiveErr) {
      this.emit('error', recursiveErr)
      return
    }

    let idx = 0

    files.forEach((file) => {
      fs.stat(file, (statErr, stats) => {
        if (statErr) {
          this.emit('error', statErr)
          return
        }

        let lastModified = stats && stats.mtime && stats.mtime.valueOf()

        if (lastModified && (Date.now() - lastModified) / 1000 > this.ttl) {
          fs.unlinkSync(file)
        }

        if (++idx === files.length) {
          deleteEmpty(dir)
          done()
        }
      })
    })
  })
}

/**
 * Fires up the internal database, loading any existing data from disk.
 *
 * @return {Promise<Collection>} Instance of initialised LokiJS collection
 */
FileCache.prototype.startDatabase = function () {
  return new Promise((resolve, reject) => {
    let db = new Loki(
      path.join(__dirname, '../db.json'),
      {
        autoload: true,
        autoloadCallback: () => {
          let collection = db.getCollection('cache')

          if (collection === null) {
            collection = db.addCollection('cache')
          }

          resolve(collection)
        },
        autosave: true,
        autosaveInterval: 1000
      }
    )
  })
}

/**
 * @param  {Object} options
 * @returns {FileCache} new instance of FileCache
 */
module.exports = function (options) {
  return new FileCache(options)
}
